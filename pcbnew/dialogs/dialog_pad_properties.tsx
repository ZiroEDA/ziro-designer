// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAD_PROPERTIES` (pcbnew/dialogs/dialog_pad_properties.cpp), method for method.
 *
 * The class holds what the C++ holds: the working-copy `m_previewPad` every change is
 * transferred into (`transferDataToPad`) and the preview canvas draws, the UNIT_BINDERs, and
 * the state of each control the derived class reads or sets - a wxChoice as the wxChoice model,
 * a check box as its value and enable. `DialogPadProperties` below is the window: it renders
 * DIALOG_PAD_PROPERTIES_BASE from those members, routes each control's event to the handler
 * the `_base.cpp` connects, and hosts the PCB_DRAW_PANEL_GAL `prepareCanvas` builds.
 *
 * The board model stores a pad's position board-absolute, so the position box shows the
 * absolute one and `transferDataToPad` converts it back to footprint-local (`pos -=
 * fp->GetPosition(); RotatePoint( pos, -fp->GetOrientation() )`), as upstream.
 */
import { type JSX, useEffect, useReducer, useRef, useState } from 'react';
import { KiBitmapBundle } from '@ziroeda/common/bitmap.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import {
  MessageDialogError,
  MessageDialogOkCancel,
} from '@ziroeda/common/dialogs/dialog_message.js';
import { pcbIUScale, unitLabel } from '@ziroeda/common/eda_units.js';
import { BRIGHTENED, SELECTED } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { DRAW_PANEL_GAL_PARENT } from '@ziroeda/common/draw_panel_gal.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { drawPanelWindow, loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import {
  LAYER_GRID,
  LAYER_LOCKED_ITEM_SHADOW,
  LAYER_NON_PLATEDHOLES,
  LAYER_PAD_HOLEWALLS,
  LAYER_PAD_NETNAMES,
  LAYER_PAD_PLATEDHOLES,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { IsCopperLayer, IsInnerCopperLayer } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ORIGIN_VIEWITEM } from '@ziroeda/common/origin_viewitem.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { MARGIN_OFFSET_BINDER } from '@ziroeda/common/widgets/margin_offset_binder.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { BITMAPS } from '@ziroeda/include/bitmaps/bitmaps_list.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import {
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_45, ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { wxChoice } from '@ziroeda/wx/choice.js';
import type { CHECK, CHOICE } from '@ziroeda/wx/controls.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { DEFAULT_PAD_DRILL_DIAMETER_MM } from '../board_design_settings_defaults.js';
import { DRCE_PAD_TH_WITH_NO_HOLE, DRCE_PADSTACK, DRCE_PADSTACK_INVALID } from '../drc/drc_item.js';
import type { FOOTPRINT } from '../footprint.js';
import { UNCONNECTED_NET } from '../netinfo.js';
import { PAD } from '../pad.js';
import { GetDefaultIpcRoundingRatio, PadHasMeaningfulRoundingRadius } from '../pad_utils.js';
import {
  CUSTOM_SHAPE_ZONE_MODE,
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PAD_PROP,
  PAD_SHAPE,
  PADSTACK,
  PADSTACK_MODE,
  PADSTACK_POST_MACHINING_PROPS,
  UNCONNECTED_LAYER_MODE,
} from '../padstack.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import type { PCB_RENDER_SETTINGS } from '../pcb_painter.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { ZONE_CONNECTION } from '../zones.js';
import { DIALOG_PAD_PROPERTIES_BASE, type UNIT } from './dialog_pad_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** ZONE_CONNECTION, spelled as the Properties panel and the footprint dialog spell it. */
export type ZoneConnection = 'inherited' | 'none' | 'thermal' | 'full' | 'tht_thermal';

/**
 * `UNCONNECTED_LAYER_MODE` (pcbnew/padstack.h), as the via dialog's annular-rings row spells
 * it. `start_end_only` has no pad spelling in the file format, so it round-trips on a via only.
 */
export type UnconnectedLayerMode =
  /** Copper on every layer of the span, connected or not. KiCad's default. */
  | 'keep_all'
  /** Copper only where connected - outer layers included. */
  | 'remove_all'
  /** Copper where connected, plus the end layers: "Keep outside layers". */
  | 'remove_except_start_and_end'
  /** Copper on the two end layers and nowhere else, connections ignored. */
  | 'start_end_only';

// list of pad shapes, ordered like the pad shape wxChoice in dialog.
const code_shape: readonly PAD_SHAPE[] = [
  PAD_SHAPE.CIRCLE,
  PAD_SHAPE.OVAL,
  PAD_SHAPE.RECTANGLE,
  PAD_SHAPE.TRAPEZOID,
  PAD_SHAPE.ROUNDRECT,
  PAD_SHAPE.CHAMFERED_RECT,
  PAD_SHAPE.CHAMFERED_RECT, // choice = CHOICE_SHAPE_CHAMFERED_ROUNDED_RECT
  PAD_SHAPE.CUSTOM, // choice = CHOICE_SHAPE_CUSTOM_CIRC_ANCHOR
  PAD_SHAPE.CUSTOM, // choice = PAD_SHAPE::CUSTOM_RECT_ANCHOR
];

// the ordered index of the pad shape wxChoice in dialog.
// keep it consistent with code_shape[] and dialog strings
const CHOICE_SHAPE_CIRCLE = 0;
const CHOICE_SHAPE_OVAL = 1;
const CHOICE_SHAPE_RECT = 2;
const CHOICE_SHAPE_TRAPEZOID = 3;
const CHOICE_SHAPE_ROUNDRECT = 4;
const CHOICE_SHAPE_CHAMFERED_RECT = 5;
const CHOICE_SHAPE_CHAMFERED_ROUNDED_RECT = 6;
const CHOICE_SHAPE_CUSTOM_CIRC_ANCHOR = 7;
const CHOICE_SHAPE_CUSTOM_RECT_ANCHOR = 8;

const code_type: readonly PAD_ATTRIB[] = [
  PAD_ATTRIB.PTH,
  PAD_ATTRIB.SMD,
  PAD_ATTRIB.CONN,
  PAD_ATTRIB.NPTH,
  PAD_ATTRIB.SMD, // Aperture pad :type SMD with no copper layers,
  // only on tech layers (usually only on paste layer
];

// These define have the same value as the m_PadType wxChoice GetSelected() return value
const PTH_DLG_TYPE = 0;
const SMD_DLG_TYPE = 1;
const CONN_DLG_TYPE = 2;
const NPTH_DLG_TYPE = 3;
const APERTURE_DLG_TYPE = 4;

/** `INT_MAX`, `m_spokeWidth.Validate( 0, INT_MAX )`'s bound. */
const INT_MAX = 2147483647;

/** A wxCheckBox: `GetValue()` / `IsEnabled()`. */
interface CHECK_BOX {
  value: boolean;
  enabled: boolean;
}

const checkBox = (aValue = false): CHECK_BOX => ({ value: aValue, enabled: true });

/**
 * `GetTool<PAD_TOOL>()`, found by name: PAD_TOOL's module imports the pad dialogs' callers, so a
 * value import here would be a load cycle.
 */
interface PAD_TOOL_LIKE {
  GetLastPadNumber(): string;
  SetLastPadNumber(aPadNumber: string): void;
}

/** The HTML_MESSAGE_BOX padValuesOK raises. */
export interface PAD_MESSAGES {
  title: string;
  messages: string[];
}

/** `PCB_BASE_FRAME::ShowPadPropertiesDialog`'s parent, as the dialog reads it. */
type PAD_DIALOG_FRAME = PCB_BASE_EDIT_FRAME;

export class DIALOG_PAD_PROPERTIES {
  // remember the last open page during session
  static m_page = 0;
  // Store the pad draw option during a session.
  static m_sketchPreview = false;

  readonly m_parent: PAD_DIALOG_FRAME;
  /** The pad being edited; null when the footprint editor sets the default pad. */
  readonly m_currentPad: PAD | null;
  /** A working copy used to show changes. */
  readonly m_previewPad: PAD;
  /** The pad used to create new pads in the board or footprint editor. */
  private readonly m_masterPad: PAD;
  private readonly m_board: BOARD;
  private m_initialized = false;
  m_canEditNetName = false;
  readonly m_isFpEditor: boolean;
  /** Which copper layer of the padstack is being edited. */
  m_editLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;
  private m_editLayerCtrlMap = new Map<number, PCB_LAYER_ID>();
  /** The custom shape primitives in local coords, orient 0. */
  private m_primitives: PCB_SHAPE[] = [];
  private m_selectedColor = { r: 1, g: 1, b: 1, a: 0.7 };
  m_padPreviewGAL: PCB_DRAW_PANEL_GAL | null = null;
  private m_axisOrigin: ORIGIN_VIEWITEM | null = null;

  // ----- the window's title and the hooks it answers -----
  m_title = '';
  /** `HTML_MESSAGE_BOX dlg( this, title ); dlg.ShowModal()`: what padValuesOK raised. */
  m_messages: PAD_MESSAGES | null = null;
  /** `UNIT_BINDER`'s `DisplayError` (delayedFocusHandler). */
  m_error: string | null = null;
  /** `wxMessageBox( …, wxOK | wxCANCEL | wxICON_WARNING )`, answered by the window. */
  m_confirm: ((aMessage: string, aCaption: string) => Promise<boolean>) | null = null;

  // ----- DIALOG_PAD_PROPERTIES_BASE's controls -----
  m_notebookSelection = 0;
  readonly m_padType = new wxChoice([
    _HKI('Through-hole'),
    _HKI('SMD'),
    _HKI('Edge Connector'),
    _HKI('NPTH, Mechanical'),
    _HKI('SMD Aperture'),
  ]);
  readonly m_padNumCtrl = { value: '', enabled: true };
  m_padNetShown = true;
  readonly m_padNetSelector = { netcode: 0, enabled: true };
  readonly m_cbPadstackMode = new wxChoice([
    _HKI('Normal'),
    _HKI('Front/Inner/Back'),
    _HKI('Custom'),
  ]);
  readonly m_cbEditLayer = new wxChoice([_HKI('Inner Layers')]);
  m_padstackControlsShown = true;
  readonly m_PadShapeSelector = new wxChoice([
    _HKI('Circular'),
    _HKI('Oval'),
    _HKI('Rectangular'),
    _HKI('Trapezoidal'),
    _HKI('Rounded rectangle'),
    _HKI('Chamfered rectangle'),
    _HKI('Chamfered with other corners rounded'),
    _HKI('Custom (circular base)'),
    _HKI('Custom (rectangular base)'),
  ]);
  m_shapePropsBook = 0;
  readonly m_trapAxisCtrl = new wxChoice([_HKI('Horizontal'), _HKI('Vertical')]);
  readonly m_cbTopLeft = checkBox();
  readonly m_cbTopRight = checkBox();
  readonly m_cbBottomLeft = checkBox();
  readonly m_cbBottomRight = checkBox();
  readonly m_cbTopLeft1 = checkBox();
  readonly m_cbTopRight1 = checkBox();
  readonly m_cbBottomLeft1 = checkBox();
  readonly m_cbBottomRight1 = checkBox();
  readonly m_offsetShapeOpt = checkBox();
  m_offsetCtrlsShown = true;
  m_gbSizerHoleShown = true;
  readonly m_holeShapeCtrl = new wxChoice([_HKI('Round'), _HKI('Oblong')]);
  readonly m_padToDieOpt = checkBox();
  readonly m_padToDieDelayOpt = checkBox();
  m_FlippedWarningShown = true;
  readonly m_rbCopperLayersSel = new wxChoice();
  readonly m_layerFrontAdhesive = { ...checkBox(), label: _HKI('Front adhesive') };
  readonly m_layerBackAdhesive = { ...checkBox(), label: _HKI('Back adhesive') };
  readonly m_layerFrontPaste = { ...checkBox(), label: _HKI('Front solder paste') };
  readonly m_layerBackPaste = { ...checkBox(), label: _HKI('Back solder paste') };
  readonly m_layerFrontSilk = { ...checkBox(), label: _HKI('Front silk screen') };
  readonly m_layerBackSilk = { ...checkBox(), label: _HKI('Back silk screen') };
  readonly m_layerFrontMask = { ...checkBox(), label: _HKI('Front solder mask') };
  readonly m_layerBackMask = { ...checkBox(), label: _HKI('Back solder mask') };
  readonly m_layerUserDwgs = { ...checkBox(), label: _HKI('Drafting notes') };
  readonly m_layerECO1 = { ...checkBox(), label: 'E.C.O.1' };
  readonly m_layerECO2 = { ...checkBox(), label: 'E.C.O.2' };
  readonly m_choiceFabProperty = new wxChoice([
    _HKI('None'),
    _HKI('BGA pad'),
    _HKI('Fiducial, local to footprint'),
    _HKI('Fiducial, global to board'),
    _HKI('Test point pad'),
    _HKI('Heatsink pad'),
    _HKI('Mechanical'),
    _HKI('Castellated pad (TH only)'),
    _HKI('Press-fit (round TH only)'),
  ]);
  m_legacyTeardropsShown = true;
  readonly m_cbTeardrops = checkBox();
  readonly m_cbPreferZoneConnection = checkBox();
  readonly m_cbTeardropsUseNextTrack = checkBox();
  m_spTeardropHDPercent = 90;
  m_spTeardropLenPercent = 40;
  m_spTeardropSizePercent = 100;
  readonly m_curvedEdges = checkBox();
  /** `m_minTrackWidthHint` / `m_stLenPercentHint` / `m_stWidthPercentHint`. */
  m_teardropHint = 'd';
  m_bitmapTeardrop: BITMAPS = BITMAPS.teardrop_sizes;
  readonly m_ZoneConnectionChoice = new wxChoice([
    _HKI('From parent footprint'),
    _HKI('Solid'),
    _HKI('Thermal relief'),
    _HKI('None'),
  ]);
  readonly m_ZoneCustomPadShape = new wxChoice([_HKI('Pad shape'), _HKI('Pad convex hull')]);
  m_nonCopperWarningBook = 0;
  readonly m_topPostMachining = new wxChoice([
    _HKI('None'),
    _HKI('Countersink'),
    _HKI('Counterbore'),
  ]);
  readonly m_bottomPostMachining = new wxChoice([
    _HKI('None'),
    _HKI('Countersink'),
    _HKI('Counterbore'),
  ]);
  readonly m_backDrillChoice = new wxChoice([
    _HKI('None'),
    _HKI('Top'),
    _HKI('Bottom'),
    _HKI('Top & bottom'),
  ]);
  /** wxBitmapComboBoxes; `GetClientData( i )` is `m_backDrillLayers[i]`. */
  readonly m_backDrillTopLayer = new wxChoice([_HKI('dummy')]);
  readonly m_backDrillBottomLayer = new wxChoice([_HKI('dummy')]);
  private m_backDrillLayers: PCB_LAYER_ID[] = [];
  m_stackupImagesBook = 0;
  m_parentInfo = '';
  readonly m_cbShowPadOutline = checkBox();

  // ----- the binders -----
  readonly m_posX: UNIT_BINDER;
  readonly m_posY: UNIT_BINDER;
  readonly m_sizeX: UNIT_BINDER;
  readonly m_sizeY: UNIT_BINDER;
  readonly m_offsetX: UNIT_BINDER;
  readonly m_offsetY: UNIT_BINDER;
  readonly m_padToDie: UNIT_BINDER;
  readonly m_padToDieDelay: UNIT_BINDER;
  readonly m_trapDelta: UNIT_BINDER;
  readonly m_cornerRadius: UNIT_BINDER;
  readonly m_cornerRatio: UNIT_BINDER;
  readonly m_chamferRatio: UNIT_BINDER;
  readonly m_mixedCornerRatio: UNIT_BINDER;
  readonly m_mixedChamferRatio: UNIT_BINDER;
  readonly m_holeX: UNIT_BINDER;
  readonly m_holeY: UNIT_BINDER;
  readonly m_clearance: UNIT_BINDER;
  readonly m_maskMargin: UNIT_BINDER;
  readonly m_pasteMargin: MARGIN_OFFSET_BINDER;
  readonly m_thermalGap: UNIT_BINDER;
  readonly m_spokeWidth: UNIT_BINDER;
  readonly m_spokeAngle: UNIT_BINDER;
  readonly m_pad_orientation: UNIT_BINDER;
  readonly m_teardropMaxLenSetting: UNIT_BINDER;
  readonly m_teardropMaxHeightSetting: UNIT_BINDER;
  readonly m_topPostMachineSize1Binder: UNIT_BINDER;
  readonly m_topPostMachineSize2Binder: UNIT_BINDER;
  readonly m_bottomPostMachineSize1Binder: UNIT_BINDER;
  readonly m_bottomPostMachineSize2Binder: UNIT_BINDER;
  readonly m_backDrillTopSizeBinder: UNIT_BINDER;
  readonly m_backDrillBottomSizeBinder: UNIT_BINDER;

  private padTool(): PAD_TOOL_LIKE | null {
    return (this.m_parent.GetToolManager()?.FindTool('pcbnew.PadTool') ??
      null) as unknown as PAD_TOOL_LIKE | null;
  }

  constructor(aParent: PAD_DIALOG_FRAME, aPad: PAD | null) {
    const binder = (aLabel: string): UNIT_BINDER =>
      new UNIT_BINDER(aParent, aLabel, (aMessage) => {
        this.m_error = aMessage;
      });

    this.m_parent = aParent;
    this.m_posX = binder(_('Position X:'));
    this.m_posY = binder('Y:');
    this.m_sizeX = binder(_('Pad size X:'));
    this.m_sizeY = binder('Y:');
    this.m_offsetX = binder('X:');
    this.m_offsetY = binder('Y:');
    this.m_padToDie = binder(':');
    this.m_padToDieDelay = binder(':');
    this.m_trapDelta = binder(_('Trapezoid delta:'));
    this.m_cornerRadius = binder(_('Corner radius:'));
    this.m_cornerRatio = binder(_('Corner size:'));
    this.m_chamferRatio = binder(_('Chamfer size:'));
    this.m_mixedCornerRatio = binder(_('Corner size:'));
    this.m_mixedChamferRatio = binder(_('Chamfer size:'));
    this.m_holeX = binder(_('Hole size X:'));
    this.m_holeY = binder('Y:');
    this.m_clearance = binder(_('Pad clearance:'));
    this.m_maskMargin = binder(_('Solder mask expansion:'));
    this.m_pasteMargin = new MARGIN_OFFSET_BINDER(aParent.GetIuScale(), aParent.GetUserUnits());
    this.m_thermalGap = binder(_('Relief gap:'));
    this.m_spokeWidth = binder(_('Spoke width:'));
    this.m_spokeAngle = binder(_('Spoke angle:'));
    this.m_pad_orientation = binder(_('Angle:'));
    this.m_teardropMaxLenSetting = binder(_('Maximum length (L):'));
    this.m_teardropMaxHeightSetting = binder(_('Maximum width (W):'));
    this.m_topPostMachineSize1Binder = binder(_('Size:'));
    this.m_topPostMachineSize2Binder = binder(_('Angle:'));
    this.m_bottomPostMachineSize1Binder = binder(_('Size:'));
    this.m_bottomPostMachineSize2Binder = binder(_('Angle:'));
    this.m_backDrillTopSizeBinder = binder(_('Top backdrill size:'));
    this.m_backDrillBottomSizeBinder = binder(_('Bottom backdrill size:'));

    // The base's initial selections.
    this.m_padType.SetSelection(0);
    this.m_cbPadstackMode.SetSelection(2);
    this.m_cbEditLayer.SetSelection(0);
    this.m_PadShapeSelector.SetSelection(4);
    this.m_trapAxisCtrl.SetSelection(0);
    this.m_holeShapeCtrl.SetSelection(1);
    this.m_rbCopperLayersSel.SetSelection(0);
    this.m_choiceFabProperty.SetSelection(0);
    this.m_ZoneConnectionChoice.SetSelection(0);
    this.m_ZoneCustomPadShape.SetSelection(0);
    this.m_topPostMachining.SetSelection(0);
    this.m_bottomPostMachining.SetSelection(0);
    this.m_backDrillChoice.SetSelection(0);

    this.m_isFpEditor = aParent.GetFrameType() === FRAME_T.FRAME_FOOTPRINT_EDITOR;

    this.m_currentPad = aPad; // aPad can be NULL, if the dialog is called
    // from the footprint editor to set default pad setup

    this.m_board = aParent.GetBoard()!;

    // Configure display origin transforms
    this.m_posX.SetCoordType(COORD_TYPES_T.ABS_X_COORD);
    this.m_posY.SetCoordType(COORD_TYPES_T.ABS_Y_COORD);

    this.m_cbShowPadOutline.value = DIALOG_PAD_PROPERTIES.m_sketchPreview;

    this.m_masterPad = aParent.GetDesignSettings().m_Pad_Master;
    this.m_previewPad = new PAD(null);

    if (aPad) {
      this.m_title = _('Pad Properties');

      this.m_previewPad.assignPad(aPad);
      this.m_previewPad.GetTeardropParams().assign(aPad.GetTeardropParams());
      this.m_previewPad.ClearFlags(SELECTED | BRIGHTENED);
    } else {
      this.m_title = _('Default Pad Properties for Add Pad Tool');

      this.m_previewPad.assignPad(this.m_masterPad);
      this.m_previewPad.GetTeardropParams().assign(this.m_masterPad.GetTeardropParams());
    }

    // Pads have a hardcoded internal rounding ratio which is 0.25 by default, even if
    // they're not a rounded shape. This makes it hard to detect an intentional 0.25
    // ratio, or one that's only there because it's the PAD default.
    // Zero it out here to mark that we should recompute a better ratio if the user
    // selects a pad shape which would need a default rounding ratio computed for it
    this.m_previewPad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      if (!PadHasMeaningfulRoundingRadius(this.m_previewPad, aLayer))
        this.m_previewPad.SetRoundRectRadiusRatio(aLayer, 0.0);
    });

    if (this.m_isFpEditor) this.m_padNetShown = false;

    this.m_FlippedWarningShown = false;

    // Pad needs to have a parent for painting; use the parent board for its design settings
    if (!this.m_previewPad.GetParent()) this.m_previewPad.SetParent(this.m_board);

    this.m_cornerRatio.SetUnits('percent');
    this.m_chamferRatio.SetUnits('percent');
    this.m_mixedCornerRatio.SetUnits('percent');
    this.m_mixedChamferRatio.SetUnits('percent');
    this.m_pad_orientation.SetUnits('degrees');
    this.m_pad_orientation.SetPrecision(3);

    this.m_spokeAngle.SetUnits('degrees');
    this.m_spokeAngle.SetPrecision(3);

    this.m_padToDieDelay.SetUnits('ps');

    this.initValues();

    this.updateHoleControls();
    this.updatePadSizeControls();

    this.m_notebookSelection = DIALOG_PAD_PROPERTIES.m_page;

    this.m_initialized = true;

    if (
      this.m_padType.GetSelection() !== PTH_DLG_TYPE &&
      this.m_padType.GetSelection() !== NPTH_DLG_TYPE
    )
      this.m_gbSizerHoleShown = false;

    // Update widgets
    this.OnUpdateUI();
  }

  /** `~DIALOG_PAD_PROPERTIES()`: the page the session remembers. */
  Destroy(): void {
    DIALOG_PAD_PROPERTIES.m_page = this.m_notebookSelection;
    this.m_padPreviewGAL = null;
  }

  /** `DIALOG_SHIM::OnModify()`. */
  OnModify(): void {
    if (!this.m_title.startsWith('*')) this.m_title = `*${this.m_title}`;
  }

  /** `OnCancel`: `m_padPreviewGAL->StopDrawing()` before the default handler. */
  OnCancel(): void {
    this.m_padPreviewGAL?.StopDrawing();
  }

  /**
   * `prepareCanvas()` (:335-389), on the panel the window built over its `<canvas>`
   * (`new PCB_DRAW_PANEL_GAL( m_boardViewPanel, … )`).
   */
  prepareCanvas(aPanel: PCB_DRAW_PANEL_GAL): void {
    const colorSettings = this.m_parent.GetColorSettings();

    this.m_padPreviewGAL = aPanel;

    // Show the X and Y axis. It is useful because pad shape can have an offset
    // or be a complex shape.
    this.m_axisOrigin = new ORIGIN_VIEWITEM(
      colorSettings.GetColor(LAYER_GRID),
      'cross',
      100000,
      this.m_previewPad.GetPosition(),
    );
    this.m_axisOrigin.SetDrawAtZero(true);

    aPanel.UpdateColors();
    aPanel.SetStealsFocus(false);

    const parentViewControls = this.m_parent.GetCanvas()?.GetViewControls();

    if (parentViewControls)
      aPanel.GetViewControls().ApplySettings(parentViewControls.GetSettings());

    const view = aPanel.GetView();

    // fix the pad render mode (filled/not filled)
    const settings = view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;

    settings.m_ForcePadSketchModeOn = this.m_cbShowPadOutline.value;
    settings.SetHighContrast(false);
    settings.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.NORMAL;

    // don't show the locked item shadow in pad preview
    view.SetLayerVisible(LAYER_LOCKED_ITEM_SHADOW, false);

    // gives a non null grid size (0.001mm) because GAL layer does not like a 0 size grid:
    const gridsize = 0.001 * pcbIUScale.IU_PER_MM;
    view.GetGAL().SetGridSize({ x: gridsize, y: gridsize });

    // And do not show the grid:
    view.GetGAL().SetGridVisibility(false);
    view.GetGAL().SetAxesEnabled(false);
    view.Add(this.m_previewPad);
    view.Add(this.m_axisOrigin);

    aPanel.StartDrawing();
    this.redraw();
  }

  /** `OnResize`: the preview's size changed. */
  OnResize(): void {
    this.redraw();
  }

  OnPadstackModeChanged(): void {
    this.transferDataToPad(this.m_previewPad);
    this.afterPadstackModeChanged();
    this.redraw();
  }

  OnEditLayerChanged(): void {
    // Save data from the previous layer
    this.transferDataToPad(this.m_previewPad);

    switch (this.m_previewPad.Padstack().Mode()) {
      default:
      case PADSTACK_MODE.NORMAL:
        this.m_editLayer = PCB_LAYER_ID.F_Cu;
        break;

      case PADSTACK_MODE.FRONT_INNER_BACK:
        switch (this.m_cbEditLayer.GetSelection()) {
          default:
          case 0:
            this.m_editLayer = PCB_LAYER_ID.F_Cu;
            break;
          case 1:
            this.m_editLayer = PADSTACK.INNER_LAYERS;
            break;
          case 2:
            this.m_editLayer = PCB_LAYER_ID.B_Cu;
            break;
        }
        break;

      case PADSTACK_MODE.CUSTOM: {
        let layer = this.m_cbEditLayer.GetSelection();

        if (layer < 0) layer = 0;

        this.m_editLayer = this.m_editLayerCtrlMap.get(layer) ?? PCB_LAYER_ID.F_Cu;
      }
    }

    // Load controls with the current layer
    this.initPadstackLayerValues();

    this.onPadShapeSelection(false);
    this.OnOffsetCheckbox();

    this.redraw();
  }

  private updateRoundRectCornerValues(): void {
    const p = this.m_previewPad;
    const L = this.m_editLayer;

    // Note: use ChangeValue() to avoid generating a wxEVT_TEXT event
    this.m_cornerRadius.ChangeValue(p.GetRoundRectCornerRadius(L));

    this.m_cornerRatio.ChangeDoubleValue(p.GetRoundRectRadiusRatio(L) * 100.0);
    this.m_mixedCornerRatio.ChangeDoubleValue(p.GetRoundRectRadiusRatio(L) * 100.0);

    this.m_chamferRatio.ChangeDoubleValue(p.GetChamferRectRatio(L) * 100.0);
    this.m_mixedChamferRatio.ChangeDoubleValue(p.GetChamferRectRatio(L) * 100.0);
  }

  onCornerRadiusChange(): void {
    const shape = this.m_previewPad.GetShape(this.m_editLayer);

    if (shape !== PAD_SHAPE.ROUNDRECT && shape !== PAD_SHAPE.CHAMFERED_RECT) return;

    if (this.m_cornerRadius.GetValue() < 0) this.m_cornerRadius.SetText('0');

    if (this.transferDataToPad(this.m_previewPad)) {
      this.m_previewPad.SetRoundRectCornerRadius(this.m_editLayer, this.m_cornerRadius.GetValue());

      const ratio = this.m_previewPad.GetRoundRectRadiusRatio(this.m_editLayer) * 100.0;
      this.m_cornerRatio.ChangeDoubleValue(ratio);
      this.m_mixedCornerRatio.ChangeDoubleValue(ratio);

      this.redraw();
    }

    if (this.m_initialized) this.OnModify();
  }

  private getMaxChamferRatio(): number {
    // The maximum chamfer ratio is 50% of the smallest pad side if adjacent sides
    // are selected, or 100% of the smallest pad side if only one side is selected.
    let baseline = 1.0;

    const considerCheckboxes = (checkBoxes: readonly CHECK_BOX[]): void => {
      for (const ii of [0, 1, 2, 3]) {
        if (!checkBoxes[ii]!.value) continue;

        // `( ii - 1 ) % 4` on a size_t: for ii = 0, ( 2^64 - 1 ) % 4 = 3, the other neighbour.
        if (checkBoxes[(ii + 1) % 4]!.value || checkBoxes[(ii + 3) % 4]!.value) {
          // If two adjacent corners are selected, the maximum chamfer ratio is 50%
          baseline = Math.max(baseline, 0.5);
          break;
        }
      }
    };

    baseline = 1.0 - this.m_previewPad.GetRoundRectRadiusRatio(this.m_editLayer);
    considerCheckboxes([
      this.m_cbTopLeft1,
      this.m_cbTopRight1,
      this.m_cbBottomRight1,
      this.m_cbBottomLeft1,
    ]);
    considerCheckboxes([
      this.m_cbTopLeft,
      this.m_cbTopRight,
      this.m_cbBottomRight,
      this.m_cbBottomLeft,
    ]);

    // If only one corner is selected, the maximum chamfer ratio is 100%
    return baseline;
  }

  private getMaxCornerRadius(): number {
    return 1.0 - this.m_previewPad.GetChamferRectRatio(this.m_editLayer);
  }

  private updateAllowedPadChamferCorners(): void {
    const updateCheckBoxes = (aCheckBoxes: readonly CHECK_BOX[]): void => {
      for (const ii of [0, 1, 2, 3]) {
        const disable = aCheckBoxes[(ii + 1) % 4]!.value || aCheckBoxes[(ii + 3) % 4]!.value;

        aCheckBoxes[ii]!.enabled = !disable;

        if (disable) aCheckBoxes[ii]!.value = false;
      }
    };

    if (this.m_mixedChamferRatio.GetDoubleValue() > 50.0) {
      updateCheckBoxes([
        this.m_cbTopLeft1,
        this.m_cbTopRight1,
        this.m_cbBottomRight1,
        this.m_cbBottomLeft1,
      ]);
    }

    if (this.m_chamferRatio.GetDoubleValue() > 50.0) {
      updateCheckBoxes([
        this.m_cbTopLeft,
        this.m_cbTopRight,
        this.m_cbBottomRight,
        this.m_cbBottomLeft,
      ]);
    }
  }

  /** `onCornerSizePercentChange`, with the control that sent it and its text. */
  onCornerSizePercentChange(aCtrl: UNIT_BINDER, aValue: string): void {
    const shape = this.m_previewPad.GetShape(this.m_editLayer);

    if (shape !== PAD_SHAPE.ROUNDRECT && shape !== PAD_SHAPE.CHAMFERED_RECT) return;

    let changed = false;
    // wxString::ToDouble: the whole text must be a number.
    const ratioPercent = aValue.trim() === '' ? Number.NaN : Number(aValue);

    if (aCtrl === this.m_cornerRatio || aCtrl === this.m_mixedCornerRatio) {
      if (Number.isFinite(ratioPercent)) {
        // Clamp ratioPercent to acceptable value (0.0 to 50.0)
        const maxRatio = this.getMaxCornerRadius();

        if (ratioPercent < 0.0) {
          this.m_cornerRatio.SetDoubleValue(0.0);
          this.m_mixedCornerRatio.SetDoubleValue(0.0);
        } else if (ratioPercent > maxRatio * 100.0) {
          this.m_cornerRatio.SetDoubleValue(maxRatio * 100.0);
          this.m_mixedCornerRatio.SetDoubleValue(maxRatio * 100.0);
        }

        if (aCtrl === this.m_cornerRatio) this.m_mixedCornerRatio.SetText(aValue);
        else this.m_cornerRatio.SetText(aValue);

        changed = true;
      }
    } else if (aCtrl === this.m_chamferRatio || aCtrl === this.m_mixedChamferRatio) {
      if (Number.isFinite(ratioPercent)) {
        const maxRatio = this.getMaxChamferRatio();
        // Clamp ratioPercent to acceptable value (0.0 to maxRatio)
        if (ratioPercent < 0.0) {
          this.m_chamferRatio.SetDoubleValue(0.0);
          this.m_mixedChamferRatio.SetDoubleValue(0.0);
        } else if (ratioPercent > maxRatio * 100.0) {
          this.m_chamferRatio.SetDoubleValue(maxRatio * 100.0);
          this.m_mixedChamferRatio.SetDoubleValue(maxRatio * 100.0);
        }

        if (aCtrl === this.m_chamferRatio) this.m_mixedChamferRatio.SetText(aValue);
        else this.m_chamferRatio.SetText(aValue);

        this.updateAllowedPadChamferCorners();

        changed = true;
      }
    }

    if (changed && this.transferDataToPad(this.m_previewPad))
      this.m_cornerRadius.ChangeValue(this.m_previewPad.GetRoundRectCornerRadius(this.m_editLayer));

    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  private initValues(): void {
    // Disable pad net name wxTextCtrl if the caller is the footprint editor
    // because nets are living only in the board managed by the board editor
    this.m_canEditNetName = this.m_parent.IsType(FRAME_T.FRAME_PCB_EDITOR);

    const b = this.m_board;
    this.m_layerFrontAdhesive.label = b.GetLayerName(PCB_LAYER_ID.F_Adhes);
    this.m_layerBackAdhesive.label = b.GetLayerName(PCB_LAYER_ID.B_Adhes);
    this.m_layerFrontPaste.label = b.GetLayerName(PCB_LAYER_ID.F_Paste);
    this.m_layerBackPaste.label = b.GetLayerName(PCB_LAYER_ID.B_Paste);
    this.m_layerFrontSilk.label = b.GetLayerName(PCB_LAYER_ID.F_SilkS);
    this.m_layerBackSilk.label = b.GetLayerName(PCB_LAYER_ID.B_SilkS);
    this.m_layerFrontMask.label = b.GetLayerName(PCB_LAYER_ID.F_Mask);
    this.m_layerBackMask.label = b.GetLayerName(PCB_LAYER_ID.B_Mask);
    this.m_layerECO1.label = b.GetLayerName(PCB_LAYER_ID.Eco1_User);
    this.m_layerECO2.label = b.GetLayerName(PCB_LAYER_ID.Eco2_User);
    this.m_layerUserDwgs.label = b.GetLayerName(PCB_LAYER_ID.Dwgs_User);

    let absPos = { x: 0, y: 0 };
    const p = this.m_previewPad;

    if (this.m_currentPad) {
      absPos = this.m_currentPad.GetPosition();

      const footprint = this.m_currentPad.GetParentFootprint() as FOOTPRINT | null;

      if (footprint) {
        const relPos = { ...this.m_currentPad.GetFPRelativePosition() };

        if (footprint.IsFlipped()) {
          // flip pad (up/down) around its position
          p.Flip(p.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
          relPos.y = -relPos.y;
        }

        p.SetPosition(relPos);
        p.SetOrientation(this.m_currentPad.GetFPRelativeOrientation());

        // Display parent footprint info
        this.m_parentInfo = `Footprint ${footprint.Reference().GetShownText(false)} (${footprint
          .Value()
          .GetShownText(
            false,
          )}), ${footprint.IsFlipped() ? _('back side (mirrored)') : _('front side')}, rotated ${formatG(
          footprint.GetOrientation().AsDegrees(),
        )} deg`;

        this.m_FlippedWarningShown = footprint.IsFlipped();
      }

      this.m_padNumCtrl.value = p.GetNumber();
    } else {
      const padTool = this.padTool();
      this.m_padNumCtrl.value = padTool?.GetLastPadNumber() ?? '';
    }

    this.afterPadstackModeChanged();

    this.m_padNetSelector.netcode = p.GetNetCode();

    // Display current pad parameters units:
    this.m_posX.ChangeValue(absPos.x);
    this.m_posY.ChangeValue(absPos.y);

    this.m_holeX.ChangeValue(p.GetDrillSize().x);
    this.m_holeY.ChangeValue(p.GetDrillSize().y);

    this.initPadstackLayerValues();

    this.m_padToDieOpt.value = p.GetPadToDieLength() !== 0;
    this.m_padToDie.ChangeValue(p.GetPadToDieLength());

    this.m_padToDieDelayOpt.value = p.GetPadToDieDelay() !== 0;
    this.m_padToDieDelay.ChangeValue(p.GetPadToDieDelay());

    const clearance = p.GetLocalClearance();

    if (clearance !== undefined) this.m_clearance.ChangeValue(clearance);
    else this.m_clearance.SetNull();

    const maskMargin = p.GetLocalSolderMaskMargin();

    if (maskMargin !== undefined) this.m_maskMargin.ChangeValue(maskMargin);
    else this.m_maskMargin.SetNull();

    this.m_pasteMargin.SetOffsetValue(p.GetLocalSolderPasteMargin());
    this.m_pasteMargin.SetRatioValue(p.GetLocalSolderPasteMarginRatio());

    const spokeWidth = p.GetLocalThermalSpokeWidthOverride();

    if (spokeWidth !== undefined) this.m_spokeWidth.ChangeValue(spokeWidth);
    else this.m_spokeWidth.SetNull();

    const thermalGap = p.GetLocalThermalGapOverride();

    if (thermalGap !== undefined) this.m_thermalGap.ChangeValue(thermalGap);
    else this.m_thermalGap.SetNull();

    this.m_spokeAngle.ChangeAngleValue(p.GetThermalSpokeAngle());
    this.m_pad_orientation.ChangeAngleValue(p.GetOrientation());

    const td = p.GetTeardropParams();
    this.m_cbTeardrops.value = td.m_Enabled;
    this.m_cbTeardropsUseNextTrack.value = td.m_AllowUseTwoTracks;
    this.m_cbPreferZoneConnection.value = !td.m_TdOnPadsInZones;
    this.m_teardropMaxLenSetting.SetValue(td.m_TdMaxLen);
    this.m_teardropMaxHeightSetting.SetValue(td.m_TdMaxWidth);
    this.m_spTeardropLenPercent = td.m_BestLengthRatio * 100;
    this.m_spTeardropSizePercent = td.m_BestWidthRatio * 100;
    this.m_spTeardropHDPercent = td.m_WidthtoSizeFilterRatio * 100;
    this.m_curvedEdges.value = td.m_CurvedEdges;

    switch (p.GetLocalZoneConnection()) {
      default:
      case ZONE_CONNECTION.INHERITED:
        this.m_ZoneConnectionChoice.SetSelection(0);
        break;
      case ZONE_CONNECTION.FULL:
        this.m_ZoneConnectionChoice.SetSelection(1);
        break;
      case ZONE_CONNECTION.THERMAL:
        this.m_ZoneConnectionChoice.SetSelection(2);
        break;
      case ZONE_CONNECTION.NONE:
        this.m_ZoneConnectionChoice.SetSelection(3);
        break;
    }

    if (p.GetCustomShapeInZoneOpt() === CUSTOM_SHAPE_ZONE_MODE.CONVEXHULL)
      this.m_ZoneCustomPadShape.SetSelection(1);
    else this.m_ZoneCustomPadShape.SetSelection(0);

    // Type of pad selection
    const aperture = p.GetAttribute() === PAD_ATTRIB.SMD && p.IsAperturePad();

    if (aperture) {
      this.m_padType.SetSelection(APERTURE_DLG_TYPE);
    } else {
      switch (p.GetAttribute()) {
        case PAD_ATTRIB.PTH:
          this.m_padType.SetSelection(PTH_DLG_TYPE);
          break;
        case PAD_ATTRIB.SMD:
          this.m_padType.SetSelection(SMD_DLG_TYPE);
          break;
        case PAD_ATTRIB.CONN:
          this.m_padType.SetSelection(CONN_DLG_TYPE);
          break;
        case PAD_ATTRIB.NPTH:
          this.m_padType.SetSelection(NPTH_DLG_TYPE);
          break;
      }
    }

    switch (p.GetProperty()) {
      case PAD_PROP.NONE:
        this.m_choiceFabProperty.SetSelection(0);
        break;
      case PAD_PROP.BGA:
        this.m_choiceFabProperty.SetSelection(1);
        break;
      case PAD_PROP.FIDUCIAL_LOCAL:
        this.m_choiceFabProperty.SetSelection(2);
        break;
      case PAD_PROP.FIDUCIAL_GLBL:
        this.m_choiceFabProperty.SetSelection(3);
        break;
      case PAD_PROP.TESTPOINT:
        this.m_choiceFabProperty.SetSelection(4);
        break;
      case PAD_PROP.HEATSINK:
        this.m_choiceFabProperty.SetSelection(5);
        break;
      case PAD_PROP.MECHANICAL:
        this.m_choiceFabProperty.SetSelection(6);
        break;
      case PAD_PROP.CASTELLATED:
        this.m_choiceFabProperty.SetSelection(7);
        break;
      case PAD_PROP.PRESSFIT:
        this.m_choiceFabProperty.SetSelection(8);
        break;
    }

    if (p.GetDrillShape() !== PAD_DRILL_SHAPE.OBLONG) this.m_holeShapeCtrl.SetSelection(0);
    else this.m_holeShapeCtrl.SetSelection(1);

    // Backdrills are read through the PADSTACK accessors, which key the top/bottom side on the
    // drill's start layer, so a pad written by KiCad 10.0 (top backdrill in the tertiary slot)
    // loads correctly.
    const padstack = p.Padstack();
    const topBackdrillSize = padstack.GetBackdrillSize(true);
    const bottomBackdrillSize = padstack.GetBackdrillSize(false);

    this.m_backDrillChoice.SetSelection(
      topBackdrillSize !== undefined
        ? bottomBackdrillSize !== undefined
          ? 3
          : 1
        : bottomBackdrillSize !== undefined
          ? 2
          : 0,
    );

    const loadBackdrill = (
      aSize: number | undefined,
      aEndLayer: PCB_LAYER_ID,
      aSizeBinder: UNIT_BINDER,
      aLayerCtrl: wxChoice,
    ): void => {
      if (aSize === undefined) {
        aSizeBinder.SetValue(0);
        return;
      }

      aSizeBinder.SetValue(aSize);

      for (let i = 0; i < aLayerCtrl.GetCount(); ++i) {
        if (this.m_backDrillLayers[i] === aEndLayer) {
          aLayerCtrl.SetSelection(i);
          break;
        }
      }
    };

    loadBackdrill(
      topBackdrillSize,
      padstack.GetBackdrillEndLayer(true),
      this.m_backDrillTopSizeBinder,
      this.m_backDrillTopLayer,
    );
    loadBackdrill(
      bottomBackdrillSize,
      padstack.GetBackdrillEndLayer(false),
      this.m_backDrillBottomSizeBinder,
      this.m_backDrillBottomLayer,
    );

    // Post machining
    const loadPostMachining = (
      aProps: PADSTACK_POST_MACHINING_PROPS,
      aChoice: wxChoice,
      aSize1: UNIT_BINDER,
      aSize2: UNIT_BINDER,
    ): void => {
      if (aProps.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE) aChoice.SetSelection(2);
      else if (aProps.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK) aChoice.SetSelection(1);
      else aChoice.SetSelection(0);

      aSize1.SetValue(aProps.size);

      if (aProps.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK) {
        aSize2.SetUnits('degrees');
        aSize2.SetDoubleValue(aProps.angle / 10.0);
      } else {
        aSize2.SetValue(aProps.depth);
      }
    };

    loadPostMachining(
      padstack.FrontPostMachining(),
      this.m_topPostMachining,
      this.m_topPostMachineSize1Binder,
      this.m_topPostMachineSize2Binder,
    );
    loadPostMachining(
      padstack.BackPostMachining(),
      this.m_bottomPostMachining,
      this.m_bottomPostMachineSize1Binder,
      this.m_bottomPostMachineSize2Binder,
    );

    this.updatePadLayersList(p.GetLayerSet(), p.GetRemoveUnconnected(), p.GetKeepTopBottom());

    // Update some dialog widgets state (Enable/disable options):
    this.onPadShapeSelection(false);
    this.OnOffsetCheckbox();
    this.updateHoleControls();
  }

  private initPadstackLayerValues(): void {
    const p = this.m_previewPad;
    const L = this.m_editLayer;

    this.m_primitives = p.GetPrimitives(L);

    this.m_sizeX.ChangeValue(p.GetSize(L).x);
    this.m_sizeY.ChangeValue(p.GetSize(L).y);

    const offset = p.GetOffset(L);
    this.m_offsetShapeOpt.value = offset.x !== 0 || offset.y !== 0;
    this.m_offsetX.ChangeValue(offset.x);
    this.m_offsetY.ChangeValue(offset.y);

    if (p.GetDelta(L).x) {
      this.m_trapDelta.ChangeValue(p.GetDelta(L).x);
      this.m_trapAxisCtrl.SetSelection(0);
    } else {
      this.m_trapDelta.ChangeValue(p.GetDelta(L).y);
      this.m_trapAxisCtrl.SetSelection(1);
    }

    switch (p.GetShape(L)) {
      default:
      case PAD_SHAPE.CIRCLE:
        this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_CIRCLE);
        break;
      case PAD_SHAPE.OVAL:
        this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_OVAL);
        break;
      case PAD_SHAPE.RECTANGLE:
        this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_RECT);
        break;
      case PAD_SHAPE.TRAPEZOID:
        this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_TRAPEZOID);
        break;
      case PAD_SHAPE.ROUNDRECT:
        this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_ROUNDRECT);
        break;

      case PAD_SHAPE.CHAMFERED_RECT:
        if (p.GetRoundRectRadiusRatio(L) > 0.0)
          this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_CHAMFERED_ROUNDED_RECT);
        else this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_CHAMFERED_RECT);
        break;

      case PAD_SHAPE.CUSTOM:
        if (p.GetAnchorPadShape(L) === PAD_SHAPE.RECTANGLE)
          this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_CUSTOM_RECT_ANCHOR);
        else this.m_PadShapeSelector.SetSelection(CHOICE_SHAPE_CUSTOM_CIRC_ANCHOR);
        break;
    }

    const chamferPositions = p.GetChamferPositions(L);

    this.m_cbTopLeft.value = (chamferPositions & RECT_CHAMFER_TOP_LEFT) !== 0;
    this.m_cbTopLeft1.value = (chamferPositions & RECT_CHAMFER_TOP_LEFT) !== 0;
    this.m_cbTopRight.value = (chamferPositions & RECT_CHAMFER_TOP_RIGHT) !== 0;
    this.m_cbTopRight1.value = (chamferPositions & RECT_CHAMFER_TOP_RIGHT) !== 0;
    this.m_cbBottomLeft.value = (chamferPositions & RECT_CHAMFER_BOTTOM_LEFT) !== 0;
    this.m_cbBottomLeft1.value = (chamferPositions & RECT_CHAMFER_BOTTOM_LEFT) !== 0;
    this.m_cbBottomRight.value = (chamferPositions & RECT_CHAMFER_BOTTOM_RIGHT) !== 0;
    this.m_cbBottomRight1.value = (chamferPositions & RECT_CHAMFER_BOTTOM_RIGHT) !== 0;

    this.updateRoundRectCornerValues();
  }

  private afterPadstackModeChanged(): void {
    // NOTE: synchronize changes here with DIALOG_TRACK_VIA_PROPERTIES::afterPadstackModeChanged
    const b = this.m_board;
    this.m_cbEditLayer.Clear();

    switch (this.m_previewPad.Padstack().Mode()) {
      case PADSTACK_MODE.NORMAL:
        this.m_cbPadstackMode.SetSelection(0);
        this.m_cbEditLayer.Append(b.GetLayerName(PCB_LAYER_ID.F_Cu));
        this.m_cbEditLayer.Enable(false);
        this.m_editLayer = PCB_LAYER_ID.F_Cu;
        this.m_editLayerCtrlMap = new Map([[0, PCB_LAYER_ID.F_Cu]]);
        break;

      case PADSTACK_MODE.FRONT_INNER_BACK: {
        this.m_cbPadstackMode.SetSelection(1);
        this.m_cbEditLayer.Enable(true);

        this.m_cbEditLayer.Append([
          b.GetLayerName(PCB_LAYER_ID.F_Cu),
          _('Inner Layers'),
          b.GetLayerName(PCB_LAYER_ID.B_Cu),
        ]);

        this.m_editLayerCtrlMap = new Map([
          [0, PCB_LAYER_ID.F_Cu],
          [1, PADSTACK.INNER_LAYERS],
          [2, PCB_LAYER_ID.B_Cu],
        ]);

        if (this.m_editLayer !== PCB_LAYER_ID.F_Cu && this.m_editLayer !== PCB_LAYER_ID.B_Cu)
          this.m_editLayer = PADSTACK.INNER_LAYERS;

        break;
      }

      case PADSTACK_MODE.CUSTOM: {
        this.m_cbPadstackMode.SetSelection(2);
        this.m_cbEditLayer.Enable(true);
        const layers = LSET.AllCuMask().and(b.GetEnabledLayers());

        for (const layer of layers.UIOrder()) {
          const idx = this.m_cbEditLayer.Append(b.GetLayerName(layer));
          this.m_editLayerCtrlMap.set(idx, layer);
        }

        break;
      }
    }

    for (const [idx, layer] of [...this.m_editLayerCtrlMap].sort((a, c) => a[0] - c[0])) {
      if (layer === this.m_editLayer) {
        this.m_cbEditLayer.SetSelection(idx);
        break;
      }
    }
  }

  /** `onChangePadDrawMode`. */
  onChangePadDrawMode(): void {
    DIALOG_PAD_PROPERTIES.m_sketchPreview = this.m_cbShowPadOutline.value;

    if (this.m_padPreviewGAL) {
      const view = this.m_padPreviewGAL.GetView();

      // fix the pad render mode (filled/not filled)
      const settings = view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;

      settings.m_ForcePadSketchModeOn = this.m_cbShowPadOutline.value;
      settings.SetHighContrast(false);
      settings.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.NORMAL;
    }

    this.redraw();
  }

  OnPadShapeSelection(): void {
    this.onPadShapeSelection(true);
  }

  private onPadShapeSelection(aUpdateSpokeAngle: boolean): void {
    const p = this.m_previewPad;
    const L = this.m_editLayer;

    switch (this.m_PadShapeSelector.GetSelection()) {
      case CHOICE_SHAPE_CIRCLE:
      case CHOICE_SHAPE_OVAL:
      case CHOICE_SHAPE_RECT:
        this.m_shapePropsBook = 0;
        break;

      case CHOICE_SHAPE_TRAPEZOID:
        this.m_shapePropsBook = 1;
        break;

      case CHOICE_SHAPE_ROUNDRECT: {
        this.m_shapePropsBook = 2;

        // Reasonable defaults
        if (p.GetRoundRectRadiusRatio(L) === 0.0) {
          const ipcRadiusRatio = GetDefaultIpcRoundingRatio(p, L);
          this.m_cornerRatio.ChangeDoubleValue(ipcRadiusRatio * 100);
        }

        break;
      }

      case CHOICE_SHAPE_CHAMFERED_RECT:
        this.m_shapePropsBook = 3;

        // Reasonable default
        if (p.GetChamferRectRatio(L) === 0.0) p.SetChamferRectRatio(L, 0.2);

        // Ensure the displayed value is up to date:
        this.m_chamferRatio.ChangeDoubleValue(p.GetChamferRectRatio(L) * 100.0);

        // A reasonable default is one corner chamfered (usual for some SMD pads).
        if (
          !this.m_cbTopLeft.value &&
          !this.m_cbTopRight.value &&
          !this.m_cbBottomLeft.value &&
          !this.m_cbBottomRight.value
        ) {
          this.m_cbTopLeft.value = true;
          this.m_cbTopRight.value = false;
          this.m_cbBottomLeft.value = false;
          this.m_cbBottomRight.value = false;
        }

        break;

      case CHOICE_SHAPE_CHAMFERED_ROUNDED_RECT:
        this.m_shapePropsBook = 4;

        // Reasonable defaults
        if (p.GetRoundRectRadiusRatio(L) === 0.0 && p.GetChamferRectRatio(L) === 0.0) {
          const ipcRadiusRatio = GetDefaultIpcRoundingRatio(p, L);
          p.SetRoundRectRadiusRatio(L, ipcRadiusRatio);
          p.SetChamferRectRatio(L, 0.2);
        }

        // Ensure the displayed values are up to date:
        this.m_mixedChamferRatio.ChangeDoubleValue(p.GetChamferRectRatio(L) * 100.0);
        this.m_mixedCornerRatio.ChangeDoubleValue(p.GetRoundRectRadiusRatio(L) * 100.0);
        break;

      case CHOICE_SHAPE_CUSTOM_CIRC_ANCHOR: // PAD_SHAPE::CUSTOM, circular anchor
      case CHOICE_SHAPE_CUSTOM_RECT_ANCHOR: // PAD_SHAPE::CUSTOM, rect anchor
        this.m_shapePropsBook = 0;
        break;
    }

    if (aUpdateSpokeAngle) {
      // Note: must do this before enabling/disabling m_sizeY as we're using that as a flag to see
      // what the last shape was.
      if (this.m_PadShapeSelector.GetSelection() === CHOICE_SHAPE_CIRCLE) {
        if (this.m_sizeY.IsEnabled() && this.m_spokeAngle.GetAngleValue().equals(ANGLE_90))
          this.m_spokeAngle.SetAngleValue(ANGLE_45);
      } else {
        if (!this.m_sizeY.IsEnabled() && this.m_spokeAngle.GetAngleValue().equals(ANGLE_45))
          this.m_spokeAngle.SetAngleValue(ANGLE_90);
      }
    }

    const sel = this.m_PadShapeSelector.GetSelection();

    this.m_sizeY.Enable(sel !== CHOICE_SHAPE_CIRCLE && sel !== CHOICE_SHAPE_CUSTOM_CIRC_ANCHOR);

    this.m_offsetShapeOpt.enabled = sel !== CHOICE_SHAPE_CIRCLE;

    if (!this.m_offsetShapeOpt.enabled) this.m_offsetShapeOpt.value = false;

    // Show/hide controls depending on m_offsetShapeOpt being enabled
    this.m_offsetCtrlsShown = this.m_offsetShapeOpt.value;

    if (this.transferDataToPad(p)) this.updateRoundRectCornerValues();

    this.updatePadSizeControls();
    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  /** `OnDrillShapeSelected`: a non-circular hole asks before dropping backdrills. */
  async OnDrillShapeSelected(): Promise<void> {
    if (this.m_holeShapeCtrl.GetSelection() !== CHOICE_SHAPE_CIRCLE) {
      const hasBackdrill = this.m_backDrillChoice.GetSelection() !== 0;
      const hasTopPost = this.m_topPostMachining.GetSelection() !== 0;
      const hasBottomPost = this.m_bottomPostMachining.GetSelection() !== 0;

      if (hasBackdrill || hasTopPost || hasBottomPost) {
        const ok =
          (await this.m_confirm?.(
            _(
              'Switching to non-circular hole will disable backdrills and post-machining. Continue?',
            ),
            _('Warning'),
          )) ?? true;

        if (!ok) {
          this.m_holeShapeCtrl.SetSelection(CHOICE_SHAPE_CIRCLE);
          return;
        }
      }
    }

    this.transferDataToPad(this.m_previewPad);
    this.updateHoleControls();
    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  PadOrientEvent(): void {
    this.transferDataToPad(this.m_previewPad);
    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  private UpdateLayersDropdown(): void {
    const b = this.m_board;
    const sel = this.m_rbCopperLayersSel;
    sel.Clear();

    switch (this.m_padType.GetSelection()) {
      case PTH_DLG_TYPE:
        sel.Append(_('All copper layers'));
        sel.Append(
          `${b.GetLayerName(PCB_LAYER_ID.F_Cu)}, ${b.GetLayerName(PCB_LAYER_ID.B_Cu)} and connected layers`,
        );
        sel.Append(_('Connected layers only'));
        sel.Append(_('None'));
        break;

      case NPTH_DLG_TYPE:
        sel.Append(`${b.GetLayerName(PCB_LAYER_ID.F_Cu)} and ${b.GetLayerName(PCB_LAYER_ID.B_Cu)}`);
        sel.Append(b.GetLayerName(PCB_LAYER_ID.F_Cu));
        sel.Append(b.GetLayerName(PCB_LAYER_ID.B_Cu));
        sel.Append(_('None'));
        break;

      case SMD_DLG_TYPE:
      case CONN_DLG_TYPE:
        sel.Append(b.GetLayerName(PCB_LAYER_ID.F_Cu));
        sel.Append(b.GetLayerName(PCB_LAYER_ID.B_Cu));
        break;

      case APERTURE_DLG_TYPE:
        sel.Append(_('None'));
        break;
    }

    this.m_backDrillTopLayer.Clear();
    this.m_backDrillBottomLayer.Clear();
    this.m_backDrillLayers = [];

    for (const layerId of b.GetEnabledLayers().UIOrder()) {
      if (IsCopperLayer(layerId)) {
        const layerName = b.GetLayerName(layerId);
        this.m_backDrillTopLayer.Append(layerName);
        this.m_backDrillBottomLayer.Append(layerName);
        this.m_backDrillLayers.push(layerId);
      }
    }
  }

  PadTypeSelected(): void {
    let hasHole = true;
    let hasConnection = true;

    switch (this.m_padType.GetSelection()) {
      case PTH_DLG_TYPE:
        hasHole = true;
        hasConnection = true;
        break;
      case SMD_DLG_TYPE:
        hasHole = false;
        hasConnection = true;
        break;
      case CONN_DLG_TYPE:
        hasHole = false;
        hasConnection = true;
        break;
      case NPTH_DLG_TYPE:
        hasHole = true;
        hasConnection = false;
        break;
      case APERTURE_DLG_TYPE:
        hasHole = false;
        hasConnection = false;
        break;
    }

    // Pad type just changed, so the old pad's layer set is no longer meaningful.  Pass nullopt
    // to populate the defaults for the new type.
    this.updatePadLayersList(
      null,
      this.m_previewPad.GetRemoveUnconnected(),
      this.m_previewPad.GetKeepTopBottom(),
    );

    this.m_gbSizerHoleShown = hasHole;

    if (!hasHole) {
      this.m_holeX.ChangeValue(0);
      this.m_holeY.ChangeValue(0);
    } else if (this.m_holeX.GetValue() === 0) {
      if (this.m_currentPad) {
        this.m_holeX.ChangeValue(this.m_currentPad.GetDrillSize().x);
        this.m_holeY.ChangeValue(this.m_currentPad.GetDrillSize().y);
      } else {
        this.m_holeX.ChangeValue(pcbIUScale.mmToIU(DEFAULT_PAD_DRILL_DIAMETER_MM));
      }
    }

    if (!hasConnection) {
      this.m_padNumCtrl.value = '';
      this.m_padNetSelector.netcode = 0;
      this.m_padToDieOpt.value = false;
      this.m_padToDieDelayOpt.value = false;
    } else if (this.m_padNumCtrl.value === '' && this.m_currentPad) {
      this.m_padNumCtrl.value = this.m_currentPad.GetNumber();
      this.m_padNetSelector.netcode = this.m_currentPad.GetNetCode();
    }

    this.transferDataToPad(this.m_previewPad);

    // For now, padstack controls only enabled for PTH pads
    const enablePadstack = this.m_padType.GetSelection() === PTH_DLG_TYPE;
    this.m_padstackControlsShown = enablePadstack;

    if (!enablePadstack) {
      this.m_editLayer = PCB_LAYER_ID.F_Cu;
      this.afterPadstackModeChanged();
    }

    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  /** `OnUpdateUI`: m_panelGeneral's wxEVT_UPDATE_UI, which wx sends every idle. */
  OnUpdateUI(): void {
    let hasHole = true;
    let hasConnection = true;

    switch (this.m_padType.GetSelection()) {
      case PTH_DLG_TYPE /* PTH */:
        hasHole = true;
        hasConnection = true;
        break;
      case SMD_DLG_TYPE /* SMD */:
        hasHole = false;
        hasConnection = true;
        break;
      case CONN_DLG_TYPE /* CONN */:
        hasHole = false;
        hasConnection = true;
        break;
      case NPTH_DLG_TYPE /* NPTH */:
        hasHole = true;
        hasConnection = false;
        break;
      case APERTURE_DLG_TYPE /* Aperture */:
        hasHole = false;
        hasConnection = false;
        break;
    }

    // Enable/disable hole controls
    this.m_holeShapeCtrl.Enable(hasHole);
    this.m_holeX.Enable(hasHole);
    this.m_holeY.Enable(hasHole && this.m_holeShapeCtrl.GetSelection() === CHOICE_SHAPE_OVAL);

    // Enable/disable number and net
    this.m_padNumCtrl.enabled = hasConnection;

    if (this.m_padNetShown)
      this.m_padNetSelector.enabled =
        hasConnection && this.m_canEditNetName && this.m_currentPad !== null;

    // Enable/disable pad length-to-die
    this.m_padToDieOpt.enabled = hasConnection;
    this.m_padToDieDelayOpt.enabled = hasConnection;

    if (!this.m_padToDieOpt.enabled) this.m_padToDieOpt.value = false;

    if (!this.m_padToDieDelayOpt.enabled) this.m_padToDieDelayOpt.value = false;

    // We can show/hide this here because it doesn't require the layout to be refreshed.
    this.m_padToDie.Show(this.m_padToDieOpt.value);
    this.m_padToDieDelay.Show(this.m_padToDieDelayOpt.value);

    // Enable/disable Copper Layers control
    this.m_rbCopperLayersSel.Enable(this.m_padType.GetSelection() !== APERTURE_DLG_TYPE);

    const cu_set = this.m_previewPad.GetLayerSet().and(LSET.AllCuMask());

    switch (this.m_padType.GetSelection()) {
      case PTH_DLG_TYPE:
        if (!cu_set.any()) this.m_stackupImagesBook = 3;
        else if (!this.m_previewPad.GetRemoveUnconnected()) this.m_stackupImagesBook = 0;
        else if (this.m_previewPad.GetKeepTopBottom()) this.m_stackupImagesBook = 1;
        else this.m_stackupImagesBook = 2;

        break;

      case NPTH_DLG_TYPE:
        if (cu_set.test(PCB_LAYER_ID.F_Cu) && cu_set.test(PCB_LAYER_ID.B_Cu))
          this.m_stackupImagesBook = 4;
        else if (cu_set.test(PCB_LAYER_ID.F_Cu)) this.m_stackupImagesBook = 5;
        else if (cu_set.test(PCB_LAYER_ID.B_Cu)) this.m_stackupImagesBook = 6;
        else this.m_stackupImagesBook = 7;

        break;

      case SMD_DLG_TYPE:
      case CONN_DLG_TYPE:
      case APERTURE_DLG_TYPE:
        this.m_stackupImagesBook = 3;
        break;
    }

    this.m_legacyTeardropsShown = this.m_board.LegacyTeardrops();

    this.OnUpdateUINonCopperWarning();
  }

  /** `onTeardropsUpdateUi`: `event.Enable( !m_board->LegacyTeardrops() )`. */
  TeardropsEnabled(): boolean {
    return !this.m_board.LegacyTeardrops();
  }

  private OnUpdateUINonCopperWarning(): void {
    const isOnCopperLayer = this.m_previewPad.GetLayerSet().and(LSET.AllCuMask()).any();
    this.m_nonCopperWarningBook = isOnCopperLayer ? 0 : 1;
  }

  /**
   * `updatePadLayersList` (:1437-1527). A null @a aLayerMask is std::nullopt: the defaults for
   * the current pad type, as after a pad type change.
   */
  private updatePadLayersList(
    aLayerMask: LSET | null,
    remove_unconnected: boolean,
    keep_top_bottom: boolean,
  ): void {
    this.UpdateLayersDropdown();

    const sel = this.m_rbCopperLayersSel;
    // An empty LSET supplied by the caller is a valid user choice (a pad with no layers);
    // std::nullopt is the signal that defaults for the current pad type should be used instead.
    let effective_mask = new LSET();

    switch (this.m_padType.GetSelection()) {
      case PTH_DLG_TYPE:
        effective_mask = aLayerMask ?? PAD.PTHMask();

        if (!effective_mask.and(LSET.AllCuMask()).any()) sel.SetSelection(3);
        else if (!remove_unconnected) sel.SetSelection(0);
        else if (keep_top_bottom) sel.SetSelection(1);
        else sel.SetSelection(2);

        break;

      case SMD_DLG_TYPE:
        // The SMD/CONN UI has no "no copper" radio choice, so fall back to defaults if the
        // stored mask has no copper layers.  Otherwise saving would silently force B_Cu.
        effective_mask = aLayerMask ?? PAD.SMDMask();

        if (!effective_mask.and(LSET.AllCuMask()).any()) effective_mask = PAD.SMDMask();

        if (effective_mask.test(PCB_LAYER_ID.F_Cu)) sel.SetSelection(0);
        else sel.SetSelection(1);

        break;

      case CONN_DLG_TYPE:
        effective_mask = aLayerMask ?? PAD.ConnSMDMask();

        if (!effective_mask.and(LSET.AllCuMask()).any()) effective_mask = PAD.ConnSMDMask();

        if (effective_mask.test(PCB_LAYER_ID.F_Cu)) sel.SetSelection(0);
        else sel.SetSelection(1);

        break;

      case NPTH_DLG_TYPE:
        effective_mask = aLayerMask ?? PAD.UnplatedHoleMask();

        if (effective_mask.test(PCB_LAYER_ID.F_Cu) && effective_mask.test(PCB_LAYER_ID.B_Cu))
          sel.SetSelection(0);
        else if (effective_mask.test(PCB_LAYER_ID.F_Cu)) sel.SetSelection(1);
        else if (effective_mask.test(PCB_LAYER_ID.B_Cu)) sel.SetSelection(2);
        else sel.SetSelection(3);

        break;

      case APERTURE_DLG_TYPE:
        effective_mask = aLayerMask ?? PAD.ApertureMask();

        sel.SetSelection(0);
        break;
    }

    this.m_layerFrontAdhesive.value = effective_mask.test(PCB_LAYER_ID.F_Adhes);
    this.m_layerBackAdhesive.value = effective_mask.test(PCB_LAYER_ID.B_Adhes);

    this.m_layerFrontPaste.value = effective_mask.test(PCB_LAYER_ID.F_Paste);
    this.m_layerBackPaste.value = effective_mask.test(PCB_LAYER_ID.B_Paste);

    this.m_layerFrontSilk.value = effective_mask.test(PCB_LAYER_ID.F_SilkS);
    this.m_layerBackSilk.value = effective_mask.test(PCB_LAYER_ID.B_SilkS);

    this.m_layerFrontMask.value = effective_mask.test(PCB_LAYER_ID.F_Mask);
    this.m_layerBackMask.value = effective_mask.test(PCB_LAYER_ID.B_Mask);

    this.m_layerECO1.value = effective_mask.test(PCB_LAYER_ID.Eco1_User);
    this.m_layerECO2.value = effective_mask.test(PCB_LAYER_ID.Eco2_User);

    this.m_layerUserDwgs.value = effective_mask.test(PCB_LAYER_ID.Dwgs_User);
  }

  OnSetCopperLayers(): void {
    this.transferDataToPad(this.m_previewPad);
    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  OnSetLayers(): void {
    this.transferDataToPad(this.m_previewPad);
    this.redraw();

    if (this.m_initialized) this.OnModify();
  }

  /** `padValuesOK` (:1574-1609): CheckPad's errors refuse OK; its warnings only show. */
  private padValuesOK(): boolean {
    this.transferDataToPad(this.m_previewPad);

    const error_msgs: string[] = [];
    const warning_msgs: string[] = [];

    this.m_previewPad.CheckPad(this.m_parent.GetUnitsProvider(), true, (errorCode, msg) => {
      if (errorCode === DRCE_PADSTACK_INVALID) error_msgs.push(`Error: ${msg}`);
      else if (errorCode === DRCE_PADSTACK) warning_msgs.push(`Warning: ${msg}`);
      else if (errorCode === DRCE_PAD_TH_WITH_NO_HOLE)
        error_msgs.push(_('Error: Through hole pad has no hole.'));
    });

    if (error_msgs.length || warning_msgs.length) {
      const title = error_msgs.length ? _('Pad Properties Errors') : _('Pad Properties Warnings');

      this.m_messages = { title, messages: [...error_msgs, ...warning_msgs] };
    }

    return error_msgs.length === 0;
  }

  /** `redraw()` (:1612-1683): the preview pad autozoomed in its canvas. */
  redraw(): void {
    if (!this.m_initialized || !this.m_padPreviewGAL || !this.m_axisOrigin) return;

    const panel = this.m_padPreviewGAL;
    const view = panel.GetView();
    const settings = view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;

    panel.StopDrawing();

    // The layer used to place primitive items selected when editing custom pad shapes
    // we use here a layer never used in a pad:
    const SELECTED_ITEMS_LAYER = PCB_LAYER_ID.Dwgs_User;

    view.ClearTopLayers();
    view.SetTopLayer(SELECTED_ITEMS_LAYER);
    view.SetTopLayer(this.m_editLayer);
    settings.SetLayerColor(SELECTED_ITEMS_LAYER, this.m_selectedColor);

    for (const layer of [
      LAYER_PAD_PLATEDHOLES,
      LAYER_PAD_HOLEWALLS,
      LAYER_NON_PLATEDHOLES,
      LAYER_PAD_NETNAMES,
    ])
      view.SetTopLayer(layer);

    this.m_axisOrigin.SetPosition(this.m_previewPad.GetPosition());

    view.Update(this.m_previewPad);

    const bbox = this.m_previewPad.ViewBBox().Clone();

    if (bbox.GetSize().x > 0 && bbox.GetSize().y > 0) {
      // The origin always goes in the middle of the canvas; we want offsetting the pad
      // shape to move the pad, not the hole
      const pos = this.m_previewPad.GetPosition();
      bbox.Move({ x: -pos.x, y: -pos.y });
      let maxXExtent = Math.max(Math.abs(bbox.GetLeft()), Math.abs(bbox.GetRight()));
      let maxYExtent = Math.max(Math.abs(bbox.GetTop()), Math.abs(bbox.GetBottom()));

      // Don't blow up the GAL on too-large numbers
      if (maxXExtent > INT_MAX / 4) maxXExtent = INT_MAX / 4;

      if (maxYExtent > INT_MAX / 4) maxYExtent = INT_MAX / 4;

      const viewBox = new BOX2D(pos, { x: 0, y: 0 });
      const canvasBox = new BOX2D(pos, { x: 0, y: 0 });
      viewBox.Inflate(maxXExtent * 1.4, maxYExtent * 1.4); // add a margin
      canvasBox.Inflate(maxXExtent * 2.0, maxYExtent * 2.0);

      view.SetBoundary(canvasBox);

      // Autozoom
      view.SetViewport(viewBox);

      panel.StartDrawing();
      panel.Refresh();
    }
  }

  /**
   * `TransferDataFromWindow()` (:1701-1778). On false the dialog stays open; `m_messages` is
   * the box padValuesOK raised, which the window shows either way.
   */
  TransferDataFromWindow(): boolean {
    const commit = new BOARD_COMMIT(this.m_parent);

    if (!this.padValuesOK()) return false;

    const master = this.m_masterPad;

    if (!this.transferDataToPad(master)) return false;

    this.m_padPreviewGAL?.StopDrawing();

    const padTool = this.padTool();
    padTool?.SetLastPadNumber(master.GetNumber());

    // m_masterPad is a pattern: ensure there is no net for this pad:
    master.SetNetCode(UNCONNECTED_NET);

    const pad = this.m_currentPad;

    if (!pad)
      // Set current Pad parameters
      return true;

    commit.Modify(pad);

    // Update values

    // transferDataToPad only handles the current edit layer, so m_masterPad isn't accurate
    pad.SetPadstack(this.m_previewPad.Padstack());

    pad.SetAttribute(master.GetAttribute());
    pad.SetFPRelativeOrientation(master.GetOrientation());
    pad.SetPadToDieLength(master.GetPadToDieLength());
    pad.SetPadToDieDelay(master.GetPadToDieDelay());
    pad.SetLayerSet(master.GetLayerSet());
    pad.SetNumber(master.GetNumber());

    let padNetcode = UNCONNECTED_NET;

    // For PAD_ATTRIB::NPTH, ensure there is no net name selected
    if (master.GetAttribute() !== PAD_ATTRIB.NPTH) padNetcode = this.m_padNetSelector.netcode;

    pad.SetNetCode(padNetcode);

    pad.GetTeardropParams().assign(master.GetTeardropParams());

    // Set the fabrication property:
    pad.SetProperty(this.getSelectedProperty());

    // define the way the clearance area is defined in zones
    pad.SetCustomShapeInZoneOpt(master.GetCustomShapeInZoneOpt());

    const fp = pad.GetParentFootprint() as FOOTPRINT | null;

    // flip pad (up/down) around its position
    if (fp?.IsFlipped()) pad.Flip(pad.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

    pad.SetPosition(master.GetPosition());

    this.m_parent.SetMsgPanel?.(pad);

    // redraw the area where the pad was
    this.m_parent.GetCanvas()?.Refresh();

    commit.Push(_('Edit Pad Properties'));

    return true;
  }

  /** Return the pad property currently selected. */
  private getSelectedProperty(): PAD_PROP {
    switch (this.m_choiceFabProperty.GetSelection()) {
      case 1:
        return PAD_PROP.BGA;
      case 2:
        return PAD_PROP.FIDUCIAL_LOCAL;
      case 3:
        return PAD_PROP.FIDUCIAL_GLBL;
      case 4:
        return PAD_PROP.TESTPOINT;
      case 5:
        return PAD_PROP.HEATSINK;
      case 6:
        return PAD_PROP.MECHANICAL;
      case 7:
        return PAD_PROP.CASTELLATED;
      case 8:
        return PAD_PROP.PRESSFIT;
      default:
        return PAD_PROP.NONE;
    }
  }

  /** Show/hide the hole size Y widgets; the X label says Diameter for a round hole. */
  private updateHoleControls(): void {
    const isRound = this.m_holeShapeCtrl.GetSelection() === CHOICE_SHAPE_CIRCLE;

    if (isRound) {
      this.m_holeX.SetLabel(_('Diameter:'));
      this.m_holeY.Show(false);
    } else {
      this.m_holeX.SetLabel(_('Hole size X:'));
      this.m_holeY.Show(true);
    }

    if (!isRound) {
      // Disable all
      this.m_backDrillChoice.Enable(false);
      this.m_backDrillTopLayer.Enable(false);
      this.m_backDrillBottomLayer.Enable(false);

      this.m_topPostMachining.Enable(false);
      this.m_topPostMachineSize1Binder.Enable(false);
      this.m_topPostMachineSize2Binder.Enable(false);

      this.m_bottomPostMachining.Enable(false);
      this.m_bottomPostMachineSize1Binder.Enable(false);
      this.m_bottomPostMachineSize2Binder.Enable(false);
    } else {
      // Enable main choices
      this.m_backDrillChoice.Enable(true);
      this.m_topPostMachining.Enable(true);
      this.m_bottomPostMachining.Enable(true);

      // Update sub-controls based on selection
      this.onBackDrillChoice();
      this.onTopPostMachining();
      this.onBottomPostMachining();
    }
  }

  /** Show/hide the pad size Y widgets; the X label says Diameter for a circle. */
  private updatePadSizeControls(): void {
    const sel = this.m_PadShapeSelector.GetSelection();

    if (sel === CHOICE_SHAPE_CIRCLE || sel === CHOICE_SHAPE_CUSTOM_CIRC_ANCHOR) {
      this.m_sizeX.SetLabel(_('Diameter:'));
      this.m_sizeY.Show(false);
      this.m_bitmapTeardrop = BITMAPS.teardrop_sizes;
      this.m_teardropHint = 'd';
    } else {
      this.m_sizeX.SetLabel(_('Pad size X:'));
      this.m_sizeY.Show(true);
      this.m_bitmapTeardrop = BITMAPS.teardrop_rect_sizes;
      this.m_teardropHint = 'w';
    }
  }

  /** Copy values from dialog field to aPad's members (:1885-2345). */
  transferDataToPad(aPad: PAD): boolean {
    const newLayerMap = new Map<PCB_LAYER_ID, PCB_LAYER_ID>(); // Map of new-layers to init-from-layers
    const L = this.m_editLayer;

    const setMode = (mode: PADSTACK_MODE): void => {
      const oldStack = new PADSTACK(aPad.Padstack());

      aPad.Padstack().SetMode(mode);

      aPad.Padstack().ForEachUniqueLayer((layer: PCB_LAYER_ID) => {
        if (!oldStack.HasExplicitDefinitionForLayer(layer)) {
          if (IsInnerCopperLayer(layer) && layer !== PADSTACK.INNER_LAYERS)
            newLayerMap.set(layer, PADSTACK.INNER_LAYERS);
          else newLayerMap.set(layer, PCB_LAYER_ID.F_Cu);
        }
      });
    };

    if (!this.m_spokeWidth.Validate(0, INT_MAX, 'unscaled')) return false;

    switch (this.m_cbPadstackMode.GetSelection()) {
      default:
      case 0:
        setMode(PADSTACK_MODE.NORMAL);
        break;
      case 1:
        setMode(PADSTACK_MODE.FRONT_INNER_BACK);
        break;
      case 2:
        setMode(PADSTACK_MODE.CUSTOM);
        break;
    }

    const shapeSel = this.m_PadShapeSelector.GetSelection();

    aPad.SetAttribute(code_type[this.m_padType.GetSelection()]!);
    aPad.SetShape(L, code_shape[shapeSel]!);

    if (shapeSel === CHOICE_SHAPE_CUSTOM_RECT_ANCHOR)
      aPad.SetAnchorPadShape(L, PAD_SHAPE.RECTANGLE);
    else aPad.SetAnchorPadShape(L, PAD_SHAPE.CIRCLE);

    if (aPad.GetShape(L) === PAD_SHAPE.CUSTOM) aPad.ReplacePrimitives(L, this.m_primitives);

    const td = aPad.GetTeardropParams();
    td.m_Enabled = this.m_cbTeardrops.value;
    td.m_AllowUseTwoTracks = this.m_cbTeardropsUseNextTrack.value;
    td.m_TdOnPadsInZones = !this.m_cbPreferZoneConnection.value;
    td.m_TdMaxLen = this.m_teardropMaxLenSetting.GetIntValue();
    td.m_TdMaxWidth = this.m_teardropMaxHeightSetting.GetIntValue();
    td.m_BestLengthRatio = this.m_spTeardropLenPercent / 100;
    td.m_BestWidthRatio = this.m_spTeardropSizePercent / 100;
    td.m_CurvedEdges = this.m_curvedEdges.value;
    td.m_WidthtoSizeFilterRatio = this.m_spTeardropHDPercent / 100;

    // Read pad clearances values:
    if (this.m_clearance.IsNull()) aPad.SetLocalClearance(undefined);
    else aPad.SetLocalClearance(this.m_clearance.GetIntValue());

    if (this.m_maskMargin.IsNull()) aPad.SetLocalSolderMaskMargin(undefined);
    else aPad.SetLocalSolderMaskMargin(this.m_maskMargin.GetIntValue());

    aPad.SetLocalSolderPasteMargin(this.m_pasteMargin.GetOffsetValue());
    aPad.SetLocalSolderPasteMarginRatio(this.m_pasteMargin.GetRatioValue());

    if (this.m_spokeWidth.IsNull()) aPad.SetLocalThermalSpokeWidthOverride(undefined);
    else aPad.SetLocalThermalSpokeWidthOverride(this.m_spokeWidth.GetIntValue());

    if (this.m_thermalGap.IsNull()) aPad.SetLocalThermalGapOverride(undefined);
    else aPad.SetLocalThermalGapOverride(this.m_thermalGap.GetIntValue());

    aPad.SetThermalSpokeAngle(this.m_spokeAngle.GetAngleValue());

    // And rotation
    aPad.SetOrientation(this.m_pad_orientation.GetAngleValue());

    switch (this.m_ZoneConnectionChoice.GetSelection()) {
      default:
      case 0:
        aPad.SetLocalZoneConnection(ZONE_CONNECTION.INHERITED);
        break;
      case 1:
        aPad.SetLocalZoneConnection(ZONE_CONNECTION.FULL);
        break;
      case 2:
        aPad.SetLocalZoneConnection(ZONE_CONNECTION.THERMAL);
        break;
      case 3:
        aPad.SetLocalZoneConnection(ZONE_CONNECTION.NONE);
        break;
    }

    let pos = { x: this.m_posX.GetIntValue(), y: this.m_posY.GetIntValue() };
    const fp = aPad.GetParentFootprint() as FOOTPRINT | null;

    if (fp) {
      const fpPos = fp.GetPosition();
      pos = RotatePoint({ x: pos.x - fpPos.x, y: pos.y - fpPos.y }, fp.GetOrientation().negate());
    }

    aPad.SetPosition(pos);

    if (this.m_holeShapeCtrl.GetSelection() === CHOICE_SHAPE_CIRCLE) {
      aPad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
      aPad.SetDrillSize({ x: this.m_holeX.GetIntValue(), y: this.m_holeX.GetIntValue() });
    } else {
      aPad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);
      aPad.SetDrillSize({ x: this.m_holeX.GetIntValue(), y: this.m_holeY.GetIntValue() });
    }

    if (aPad.GetShape(L) === PAD_SHAPE.CIRCLE)
      aPad.SetSize(L, { x: this.m_sizeX.GetIntValue(), y: this.m_sizeX.GetIntValue() });
    else aPad.SetSize(L, { x: this.m_sizeX.GetIntValue(), y: this.m_sizeY.GetIntValue() });

    // For a trapezoid, test delta value (be sure delta is not too large for pad size)
    // remember DeltaSize.x is the Y size variation
    let error = false;
    const delta = { x: 0, y: 0 };

    if (aPad.GetShape(L) === PAD_SHAPE.TRAPEZOID) {
      const size = aPad.GetSize(L);

      // For a trapezoid, only one of delta.x or delta.y is not 0, depending on axis.
      if (this.m_trapAxisCtrl.GetSelection() === 0) delta.x = this.m_trapDelta.GetIntValue();
      else delta.y = this.m_trapDelta.GetIntValue();

      if (delta.x < 0 && delta.x < -size.y) {
        delta.x = -size.y + 2;
        error = true;
      }

      if (delta.x > 0 && delta.x > size.y) {
        delta.x = size.y - 2;
        error = true;
      }

      if (delta.y < 0 && delta.y < -size.x) {
        delta.y = -size.x + 2;
        error = true;
      }

      if (delta.y > 0 && delta.y > size.x) {
        delta.y = size.x - 2;
        error = true;
      }
    }

    aPad.SetDelta(L, delta);

    if (this.m_offsetShapeOpt.value)
      aPad.SetOffset(L, { x: this.m_offsetX.GetIntValue(), y: this.m_offsetY.GetIntValue() });
    else aPad.SetOffset(L, { x: 0, y: 0 });

    // Read pad length die
    if (this.m_padToDieOpt.value) aPad.SetPadToDieLength(this.m_padToDie.GetIntValue());
    else aPad.SetPadToDieLength(0);

    if (this.m_padToDieDelayOpt.value) aPad.SetPadToDieDelay(this.m_padToDieDelay.GetIntValue());
    else aPad.SetPadToDieDelay(0);

    aPad.SetNumber(this.m_padNumCtrl.value);
    aPad.SetNetCode(this.m_padNetSelector.netcode);

    let chamfers = 0;

    if (shapeSel === CHOICE_SHAPE_CHAMFERED_RECT) {
      if (this.m_cbTopLeft.value) chamfers |= RECT_CHAMFER_TOP_LEFT;

      if (this.m_cbTopRight.value) chamfers |= RECT_CHAMFER_TOP_RIGHT;

      if (this.m_cbBottomLeft.value) chamfers |= RECT_CHAMFER_BOTTOM_LEFT;

      if (this.m_cbBottomRight.value) chamfers |= RECT_CHAMFER_BOTTOM_RIGHT;
    } else if (shapeSel === CHOICE_SHAPE_CHAMFERED_ROUNDED_RECT) {
      if (this.m_cbTopLeft1.value) chamfers |= RECT_CHAMFER_TOP_LEFT;

      if (this.m_cbTopRight1.value) chamfers |= RECT_CHAMFER_TOP_RIGHT;

      if (this.m_cbBottomLeft1.value) chamfers |= RECT_CHAMFER_BOTTOM_LEFT;

      if (this.m_cbBottomRight1.value) chamfers |= RECT_CHAMFER_BOTTOM_RIGHT;
    }

    aPad.SetChamferPositions(L, chamfers);

    if (aPad.GetShape(L) === PAD_SHAPE.CUSTOM) {
      // The pad custom has a "anchor pad" (a basic shape: round or rect pad)
      // that is the minimal area of this pad, and is useful to ensure a hole
      // diameter is acceptable, and is used in Gerber files as flashed area
      // reference
      if (aPad.GetAnchorPadShape(L) === PAD_SHAPE.CIRCLE)
        aPad.SetSize(L, { x: this.m_sizeX.GetIntValue(), y: this.m_sizeX.GetIntValue() });
    }

    // Define the way the clearance area is defined in zones.  Since all non-custom pad
    // shapes are convex to begin with, this really only makes any difference for custom
    // pad shapes.
    aPad.SetCustomShapeInZoneOpt(
      this.m_ZoneCustomPadShape.GetSelection() === 0
        ? CUSTOM_SHAPE_ZONE_MODE.OUTLINE
        : CUSTOM_SHAPE_ZONE_MODE.CONVEXHULL,
    );

    switch (aPad.GetAttribute()) {
      case PAD_ATTRIB.PTH:
        break;

      case PAD_ATTRIB.CONN:
      case PAD_ATTRIB.SMD:
        // SMD and PAD_ATTRIB::CONN has no hole.
        // basically, SMD and PAD_ATTRIB::CONN are same type of pads
        // PAD_ATTRIB::CONN has just a default non technical layers that differs from SMD
        // and are intended to be used in virtual edge board connectors
        // However we can accept a non null offset,
        // mainly to allow complex pads build from a set of basic pad shapes
        aPad.SetDrillSize({ x: 0, y: 0 });
        break;

      case PAD_ATTRIB.NPTH:
        // Mechanical purpose only:
        // no net name, no pad name allowed
        aPad.SetNumber('');
        aPad.SetNetCode(UNCONNECTED_NET);
        break;
    }

    if (aPad.GetShape(L) === PAD_SHAPE.ROUNDRECT) {
      aPad.SetRoundRectRadiusRatio(L, this.m_cornerRatio.GetDoubleValue() / 100.0);
    } else if (aPad.GetShape(L) === PAD_SHAPE.CHAMFERED_RECT) {
      if (shapeSel === CHOICE_SHAPE_CHAMFERED_ROUNDED_RECT) {
        aPad.SetChamferRectRatio(L, this.m_mixedChamferRatio.GetDoubleValue() / 100.0);
        aPad.SetRoundRectRadiusRatio(L, this.m_mixedCornerRatio.GetDoubleValue() / 100.0);
      } // Choice is CHOICE_SHAPE_CHAMFERED_RECT, no rounded corner
      else {
        aPad.SetChamferRectRatio(L, this.m_chamferRatio.GetDoubleValue() / 100.0);
        aPad.SetRoundRectRadiusRatio(L, 0);
      }
    }

    aPad.SetProperty(this.getSelectedProperty());

    let padLayerMask = new LSET();
    const copperLayersChoice = this.m_rbCopperLayersSel.GetSelection();

    aPad.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.KEEP_ALL);

    switch (this.m_padType.GetSelection()) {
      case PTH_DLG_TYPE:
        switch (copperLayersChoice) {
          case 0:
            // All copper layers
            padLayerMask = padLayerMask.or(LSET.AllCuMask());
            break;

          case 1:
            // Front, back and connected
            padLayerMask = padLayerMask.or(LSET.AllCuMask());
            aPad
              .Padstack()
              .SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END);
            break;

          case 2:
            // Connected only
            padLayerMask = padLayerMask.or(LSET.AllCuMask());
            aPad.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.REMOVE_ALL);
            break;

          case 3:
            // No copper layers
            break;
        }

        break;

      case NPTH_DLG_TYPE:
        switch (copperLayersChoice) {
          case 0:
            padLayerMask.set(PCB_LAYER_ID.F_Cu).set(PCB_LAYER_ID.B_Cu);
            break;
          case 1:
            padLayerMask.set(PCB_LAYER_ID.F_Cu);
            break;
          case 2:
            padLayerMask.set(PCB_LAYER_ID.B_Cu);
            break;
          default:
            break;
        }

        break;

      case SMD_DLG_TYPE:
      case CONN_DLG_TYPE:
        switch (copperLayersChoice) {
          case 0:
            padLayerMask.set(PCB_LAYER_ID.F_Cu);
            break;
          case 1:
            padLayerMask.set(PCB_LAYER_ID.B_Cu);
            break;
        }

        break;

      case APERTURE_DLG_TYPE:
        // no copper layers
        break;
    }

    if (this.m_layerFrontAdhesive.value) padLayerMask.set(PCB_LAYER_ID.F_Adhes);

    if (this.m_layerBackAdhesive.value) padLayerMask.set(PCB_LAYER_ID.B_Adhes);

    if (this.m_layerFrontPaste.value) padLayerMask.set(PCB_LAYER_ID.F_Paste);

    if (this.m_layerBackPaste.value) padLayerMask.set(PCB_LAYER_ID.B_Paste);

    if (this.m_layerFrontSilk.value) padLayerMask.set(PCB_LAYER_ID.F_SilkS);

    if (this.m_layerBackSilk.value) padLayerMask.set(PCB_LAYER_ID.B_SilkS);

    if (this.m_layerFrontMask.value) padLayerMask.set(PCB_LAYER_ID.F_Mask);

    if (this.m_layerBackMask.value) padLayerMask.set(PCB_LAYER_ID.B_Mask);

    if (this.m_layerECO1.value) padLayerMask.set(PCB_LAYER_ID.Eco1_User);

    if (this.m_layerECO2.value) padLayerMask.set(PCB_LAYER_ID.Eco2_User);

    if (this.m_layerUserDwgs.value) padLayerMask.set(PCB_LAYER_ID.Dwgs_User);

    aPad.SetLayerSet(padLayerMask);

    // Backdrills are written through the PADSTACK accessors, which stamp each side's start layer
    // (top = F_Cu, bottom = B_Cu) so the result is read back correctly by older KiCad.
    const backDrillSel = this.m_backDrillChoice.GetSelection();
    const wantTop = backDrillSel === 1 || backDrillSel === 3; // 1: Top, 3: Top & bottom
    const wantBottom = backDrillSel === 2 || backDrillSel === 3; // 2: Bottom

    const padstack = aPad.Padstack();

    if (wantTop) {
      padstack.SetBackdrillSize(true, this.m_backDrillTopSizeBinder.GetIntValue());

      const sel = this.m_backDrillTopLayer.GetSelection();

      if (sel >= 0) padstack.SetBackdrillEndLayer(true, this.m_backDrillLayers[sel]!);
    } else {
      padstack.SetBackdrillSize(true, undefined);
    }

    if (wantBottom) {
      padstack.SetBackdrillSize(false, this.m_backDrillBottomSizeBinder.GetIntValue());

      const sel = this.m_backDrillBottomLayer.GetSelection();

      if (sel >= 0) padstack.SetBackdrillEndLayer(false, this.m_backDrillLayers[sel]!);
    } else {
      padstack.SetBackdrillSize(false, undefined);
    }

    const postMachining = (
      aChoice: wxChoice,
      aSize1: UNIT_BINDER,
      aSize2: UNIT_BINDER,
      aTarget: PADSTACK_POST_MACHINING_PROPS,
    ): void => {
      const props = new PADSTACK_POST_MACHINING_PROPS();

      switch (aChoice.GetSelection()) {
        case 1:
          props.mode = PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
          break;
        case 2:
          props.mode = PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE;
          break;
        default:
          props.mode = PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED;
          break;
      }

      props.size = aSize1.GetIntValue();

      if (props.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK)
        props.angle = KiROUND(aSize2.GetDoubleValue() * 10.0);
      else props.depth = aSize2.GetIntValue();

      aTarget.mode = props.mode;
      aTarget.size = props.size;
      aTarget.depth = props.depth;
      aTarget.angle = props.angle;
    };

    // Front Post Machining
    postMachining(
      this.m_topPostMachining,
      this.m_topPostMachineSize1Binder,
      this.m_topPostMachineSize2Binder,
      padstack.FrontPostMachining(),
    );

    // Back Post Machining
    postMachining(
      this.m_bottomPostMachining,
      this.m_bottomPostMachineSize1Binder,
      this.m_bottomPostMachineSize2Binder,
      padstack.BackPostMachining(),
    );

    // If we created new layers, initialize them
    for (const [newLayer, initFromLayer] of newLayerMap) {
      if (newLayer !== L && newLayer !== initFromLayer)
        padstack.CopperLayer(newLayer).assign(padstack.CopperLayer(initFromLayer));
    }

    return !error;
  }

  onBackDrillChoice(): void {
    const selection = this.m_backDrillChoice.GetSelection();
    // 0: None, 1: Top, 2: Bottom, 3: Both

    const enableTop = selection === 1 || selection === 3;
    const enableBottom = selection === 2 || selection === 3;

    this.m_backDrillTopSizeBinder.Enable(enableTop);
    this.m_backDrillTopLayer.Enable(enableTop);

    this.m_backDrillBottomSizeBinder.Enable(enableBottom);
    this.m_backDrillBottomLayer.Enable(enableBottom);
  }

  private postMachiningChoice(aChoice: wxChoice, aSize1: UNIT_BINDER, aSize2: UNIT_BINDER): void {
    const selection = aChoice.GetSelection();
    // 0: None, 1: Countersink, 2: Counterbore

    const enable = selection !== 0;
    aSize1.Enable(enable);
    aSize2.Enable(enable);

    if (selection === 1) {
      // Countersink
      aSize2.SetLabel(_('Angle:'));
      aSize2.SetUnits('degrees');

      if (aSize2.IsIndeterminate() || aSize2.GetDoubleValue() === 0) aSize2.SetDoubleValue(82.0);
    } else if (selection === 2) {
      // Counterbore
      aSize2.SetLabel(_('Depth:'));
      aSize2.SetUnits(this.m_parent.GetUserUnits());
    }
  }

  onTopPostMachining(): void {
    this.postMachiningChoice(
      this.m_topPostMachining,
      this.m_topPostMachineSize1Binder,
      this.m_topPostMachineSize2Binder,
    );
  }

  onBottomPostMachining(): void {
    this.postMachiningChoice(
      this.m_bottomPostMachining,
      this.m_bottomPostMachineSize1Binder,
      this.m_bottomPostMachineSize2Binder,
    );
  }

  OnOffsetCheckbox(): void {
    if (this.m_offsetShapeOpt.value) {
      this.m_offsetX.SetValue(this.m_previewPad.GetOffset(this.m_editLayer).x);
      this.m_offsetY.SetValue(this.m_previewPad.GetOffset(this.m_editLayer).y);
    }

    // Show/hide controls depending on m_offsetShapeOpt being enabled
    this.m_offsetCtrlsShown = this.m_offsetShapeOpt.value;

    this.OnValuesChanged();
  }

  OnPadToDieCheckbox(): void {
    if (this.m_padToDieOpt.value && this.m_currentPad)
      this.m_padToDie.SetValue(this.m_currentPad.GetPadToDieLength());

    this.OnValuesChanged();
  }

  OnPadToDieDelayCheckbox(): void {
    if (this.m_padToDieDelayOpt.value && this.m_currentPad)
      this.m_padToDieDelay.SetValue(this.m_currentPad.GetPadToDieDelay());

    this.OnValuesChanged();
  }

  onModify(): void {
    if (this.m_initialized) this.OnModify();
  }

  /** Called when a dimension has changed: update the graphical pad shown in the panel. */
  OnValuesChanged(): void {
    if (this.m_initialized) {
      if (!this.transferDataToPad(this.m_previewPad)) return;

      // If the pad size has changed, update the displayed values for rounded rect pads.
      this.updateAllowedPadChamferCorners();
      this.updateRoundRectCornerValues();

      this.redraw();
      this.OnModify();
    }
  }
}

/** `%g`: six significant digits, trailing zeros dropped. */
function formatG(aValue: number): string {
  return String(Number(aValue.toPrecision(6)));
}

/**
 * The preview: `new PCB_DRAW_PANEL_GAL( m_boardViewPanel, … )` over a canvas, handed to
 * `prepareCanvas`, redrawn on every resize (`OnResize`).
 */
function PadPreviewGAL({
  dialog,
  frame,
}: {
  dialog: DIALOG_PAD_PROPERTIES;
  frame: PCB_BASE_EDIT_FRAME;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    let cancelled = false;
    let panel: PCB_DRAW_PANEL_GAL | null = null;
    let observer: ResizeObserver | null = null;

    loadBitmapFontImage().then(
      (fontImage) => {
        if (cancelled) return;

        // m_boardViewPanel, whose top-level parent is the frame the dialog belongs to.
        const boardViewPanel: DRAW_PANEL_GAL_PARENT = {
          GetParent: () => frame as unknown as DRAW_PANEL_GAL_PARENT,
        };

        try {
          // opts.m_forceDisplayCursor = false: the default.
          panel = new PCB_DRAW_PANEL_GAL(
            boardViewPanel,
            drawPanelWindow(canvas, fontImage),
            new GAL_DISPLAY_OPTIONS(),
          );
        } catch (err) {
          console.warn(`Could not use OpenGL: ${(err as Error).message}`);
          return;
        }

        dialog.prepareCanvas(panel);

        observer = new ResizeObserver(() => dialog.OnResize());
        observer.observe(canvas);
      },
      (err: unknown) => console.warn(`Could not use OpenGL: ${(err as Error).message}`),
    );

    return () => {
      cancelled = true;
      observer?.disconnect();
      dialog.m_padPreviewGAL = null;
      panel?.Destroy();
    };
  }, [dialog, frame]);

  // The canvas fills the preview area the way every PCB_DRAW_PANEL_GAL pane's does.
  return (
    <div className="ze-fp-preview">
      <canvas ref={canvasRef} className="ze-fp-canvas" />
    </div>
  );
}

/** `ShowQuasiModal()` of DIALOG_PAD_PROPERTIES: the window over the class. */
export function DialogPadProperties({
  dialog,
  onClose,
}: {
  dialog: DIALOG_PAD_PROPERTIES;
  /** The dialog ended: true for wxID_OK. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [confirm, setConfirm] = useState<{
    message: string;
    caption: string;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  const [closing, setClosing] = useState(false);
  const d = dialog;
  const frame = d.m_parent;

  useEffect(() => {
    d.m_confirm = (message, caption) =>
      new Promise<boolean>((resolve) => setConfirm({ message, caption, resolve }));

    return () => {
      d.m_confirm = null;
      d.Destroy();
    };
  }, [d]);

  // wxEVT_UPDATE_UI: wx sends it every idle; here every render is one.
  d.OnUpdateUI();

  const td = d.TeardropsEnabled();
  const run = (aHandler: () => void): void => {
    aHandler();
    bump();
  };
  const unit = (aBinder: UNIT_BINDER, aOnChange: () => void = () => d.OnValuesChanged()): UNIT => ({
    label: aBinder.GetLabel(),
    value: aBinder.GetText(),
    enabled: aBinder.IsEnabled(),
    shown: aBinder.IsShown(),
    units: unitLabel(aBinder.GetUnits()),
    onChange: (aText) =>
      run(() => {
        aBinder.SetText(aText);
        aOnChange();
      }),
  });
  const check = (aBox: { value: boolean; enabled: boolean }, aOnChange: () => void): CHECK => ({
    value: aBox.value,
    enabled: aBox.enabled,
    onChange: (aOn) =>
      run(() => {
        aBox.value = aOn;
        aOnChange();
      }),
  });
  const choice = (aChoice: wxChoice, aOnChange: () => void = () => {}): CHOICE => ({
    value: aChoice.GetSelection(),
    enabled: aChoice.IsEnabled(),
    onChange: (aRow) =>
      run(() => {
        aChoice.SetSelection(aRow);
        aOnChange();
      }),
  });
  const filled = (aChoice: wxChoice, aOnChange: () => void = () => {}) => ({
    ...choice(aChoice, aOnChange),
    choices: aChoice.GetStrings(),
  });
  const layerCheck = (aBox: { value: boolean; enabled: boolean; label: string }) => ({
    ...check(aBox, () => d.OnSetLayers()),
    label: aBox.label,
  });
  const valuesChanged = (): void => d.OnValuesChanged();
  const ratio = (aBinder: UNIT_BINDER): UNIT =>
    unit(aBinder, () => d.onCornerSizePercentChange(aBinder, aBinder.GetText()));
  const modify = (): void => d.onModify();
  const board = frame.GetBoard();
  const spin = (aGet: () => number, aSet: (v: number) => void) => ({
    value: aGet(),
    enabled: td,
    onChange: (aValue: number) =>
      run(() => {
        aSet(aValue);
        d.onModify();
      }),
  });

  const onOK = (): void => {
    const ok = d.TransferDataFromWindow();

    if (ok && !d.m_messages) onClose(true);
    else {
      // padValuesOK's box is modal over the dialog; on OK the dialog closes after it.
      setClosing(ok);
      bump();
    }
  };

  const onCancel = (): void => {
    d.OnCancel();
    onClose(false);
  };

  return (
    <>
      <DIALOG_PAD_PROPERTIES_BASE
        title={d.m_title}
        m_notebook={{
          selection: d.m_notebookSelection,
          onPageChanged: (aPage) => run(() => (d.m_notebookSelection = aPage)),
        }}
        m_padType={choice(d.m_padType, () => d.PadTypeSelected())}
        m_padNumCtrl={{
          value: d.m_padNumCtrl.value,
          enabled: d.m_padNumCtrl.enabled,
          onChange: (aText) =>
            run(() => {
              d.m_padNumCtrl.value = aText;
              d.OnValuesChanged();
            }),
        }}
        padNetShown={d.m_padNetShown}
        m_padNetSelector={{
          netInfo: new Map(
            [...(board?.GetNetInfo().NetsByNetcode() ?? new Map())].map(
              ([code, net]) => [code, net.GetNetname()] as const,
            ),
          ),
          netcode: d.m_padNetSelector.netcode,
          enabled: d.m_padNetSelector.enabled,
          // FILTERED_ITEM_SELECTED -> OnValuesChanged
          onChange: (aNet) =>
            run(() => {
              d.m_padNetSelector.netcode = aNet;
              d.OnValuesChanged();
            }),
        }}
        m_posX={unit(d.m_posX)}
        m_posY={unit(d.m_posY)}
        padstackControlsShown={d.m_padstackControlsShown}
        m_cbPadstackMode={choice(d.m_cbPadstackMode, () => d.OnPadstackModeChanged())}
        m_cbEditLayer={filled(d.m_cbEditLayer, () => d.OnEditLayerChanged())}
        m_PadShapeSelector={choice(d.m_PadShapeSelector, () => d.OnPadShapeSelection())}
        shapePropsPage={d.m_shapePropsBook}
        m_trapDelta={unit(d.m_trapDelta)}
        m_trapAxisCtrl={choice(d.m_trapAxisCtrl, () => d.OnSetLayers())}
        m_cornerRatio={ratio(d.m_cornerRatio)}
        m_cornerRadius={unit(d.m_cornerRadius, () => d.onCornerRadiusChange())}
        m_chamferRatio={ratio(d.m_chamferRatio)}
        m_cbTopLeft={check(d.m_cbTopLeft, valuesChanged)}
        m_cbTopRight={check(d.m_cbTopRight, valuesChanged)}
        m_cbBottomLeft={check(d.m_cbBottomLeft, valuesChanged)}
        m_cbBottomRight={check(d.m_cbBottomRight, valuesChanged)}
        m_mixedChamferRatio={ratio(d.m_mixedChamferRatio)}
        m_cbTopLeft1={check(d.m_cbTopLeft1, valuesChanged)}
        m_cbTopRight1={check(d.m_cbTopRight1, valuesChanged)}
        m_cbBottomLeft1={check(d.m_cbBottomLeft1, valuesChanged)}
        m_cbBottomRight1={check(d.m_cbBottomRight1, valuesChanged)}
        m_mixedCornerRatio={ratio(d.m_mixedCornerRatio)}
        m_sizeX={unit(d.m_sizeX)}
        m_sizeY={unit(d.m_sizeY)}
        m_pad_orientation={unit(d.m_pad_orientation, () => d.PadOrientEvent())}
        m_offsetShapeOpt={check(d.m_offsetShapeOpt, () => d.OnOffsetCheckbox())}
        offsetCtrlsShown={d.m_offsetCtrlsShown}
        m_offsetX={unit(d.m_offsetX)}
        m_offsetY={unit(d.m_offsetY)}
        holeSizerShown={d.m_gbSizerHoleShown}
        m_holeShapeCtrl={choice(d.m_holeShapeCtrl, () => {
          void d.OnDrillShapeSelected().then(bump);
        })}
        m_holeX={unit(d.m_holeX)}
        m_holeY={unit(d.m_holeY)}
        m_padToDieOpt={check(d.m_padToDieOpt, () => d.OnPadToDieCheckbox())}
        m_padToDie={unit(d.m_padToDie)}
        m_padToDieDelayOpt={check(d.m_padToDieDelayOpt, () => d.OnPadToDieDelayCheckbox())}
        m_padToDieDelay={unit(d.m_padToDieDelay)}
        flippedWarningShown={d.m_FlippedWarningShown}
        warningBitmap={KiBitmapBundle(BITMAPS.dialog_warning)}
        m_rbCopperLayersSel={filled(d.m_rbCopperLayersSel, () => d.OnSetCopperLayers())}
        m_layerFrontAdhesive={layerCheck(d.m_layerFrontAdhesive)}
        m_layerBackAdhesive={layerCheck(d.m_layerBackAdhesive)}
        m_layerFrontPaste={layerCheck(d.m_layerFrontPaste)}
        m_layerBackPaste={layerCheck(d.m_layerBackPaste)}
        m_layerFrontSilk={layerCheck(d.m_layerFrontSilk)}
        m_layerBackSilk={layerCheck(d.m_layerBackSilk)}
        m_layerFrontMask={layerCheck(d.m_layerFrontMask)}
        m_layerBackMask={layerCheck(d.m_layerBackMask)}
        m_layerUserDwgs={layerCheck(d.m_layerUserDwgs)}
        m_layerECO1={layerCheck(d.m_layerECO1)}
        m_layerECO2={layerCheck(d.m_layerECO2)}
        m_choiceFabProperty={choice(d.m_choiceFabProperty)}
        legacyTeardropsShown={d.m_legacyTeardropsShown}
        teardropsEnabled={td}
        m_cbTeardrops={check(d.m_cbTeardrops, modify)}
        m_cbPreferZoneConnection={check(d.m_cbPreferZoneConnection, modify)}
        m_cbTeardropsUseNextTrack={check(d.m_cbTeardropsUseNextTrack, modify)}
        m_spTeardropHDPercent={spin(
          () => d.m_spTeardropHDPercent,
          (v) => (d.m_spTeardropHDPercent = v),
        )}
        teardropHint={d.m_teardropHint}
        teardropBitmap={KiBitmapBundle(d.m_bitmapTeardrop)}
        m_spTeardropLenPercent={spin(
          () => d.m_spTeardropLenPercent,
          (v) => (d.m_spTeardropLenPercent = v),
        )}
        m_teardropMaxLenSetting={unit(d.m_teardropMaxLenSetting, modify)}
        m_spTeardropSizePercent={spin(
          () => d.m_spTeardropSizePercent,
          (v) => (d.m_spTeardropSizePercent = v),
        )}
        m_teardropMaxHeightSetting={unit(d.m_teardropMaxHeightSetting, modify)}
        m_curvedEdges={check(d.m_curvedEdges, modify)}
        m_ZoneConnectionChoice={choice(d.m_ZoneConnectionChoice, modify)}
        m_ZoneCustomPadShape={choice(d.m_ZoneCustomPadShape, modify)}
        m_thermalGap={unit(d.m_thermalGap, modify)}
        m_spokeWidth={unit(d.m_spokeWidth, modify)}
        m_spokeAngle={unit(d.m_spokeAngle, modify)}
        m_clearance={unit(d.m_clearance)}
        m_maskMargin={unit(d.m_maskMargin)}
        m_pasteMargin={{
          label: _('Solder paste clearance:'),
          value: d.m_pasteMargin.GetText(),
          units: unitLabel(frame.GetUserUnits()),
          onChange: (aText) =>
            run(() => {
              d.m_pasteMargin.onTextChanged(aText);
              d.OnValuesChanged();
            }),
        }}
        nonCopperWarningPage={d.m_nonCopperWarningBook}
        m_topPostMachining={choice(d.m_topPostMachining, () => d.onTopPostMachining())}
        m_topPostMachineSize1={unit(d.m_topPostMachineSize1Binder, () => {})}
        m_topPostMachineSize2={unit(d.m_topPostMachineSize2Binder, () => {})}
        m_bottomPostMachining={choice(d.m_bottomPostMachining, () => d.onBottomPostMachining())}
        m_bottomPostMachineSize1={unit(d.m_bottomPostMachineSize1Binder, () => {})}
        m_bottomPostMachineSize2={unit(d.m_bottomPostMachineSize2Binder, () => {})}
        m_backDrillChoice={choice(d.m_backDrillChoice, () => d.onBackDrillChoice())}
        m_backDrillTopLayer={filled(d.m_backDrillTopLayer)}
        m_backDrillTopSize={unit(d.m_backDrillTopSizeBinder, () => {})}
        m_backDrillBottomLayer={filled(d.m_backDrillBottomLayer)}
        m_backDrillBottomSize={unit(d.m_backDrillBottomSizeBinder, () => {})}
        stackupImagesPage={d.m_stackupImagesBook}
        stackupImages={{
          page0: KiBitmapBundle(BITMAPS.pads_reset_unused),
          page1: KiBitmapBundle(BITMAPS.pads_remove_unused_keep_bottom),
          page2: KiBitmapBundle(BITMAPS.pads_remove_unused),
          page4: KiBitmapBundle(BITMAPS.pads_npth_top_bottom),
          page5: KiBitmapBundle(BITMAPS.pads_npth_top),
          page6: KiBitmapBundle(BITMAPS.pads_npth_bottom),
          page7: KiBitmapBundle(BITMAPS.pads_npth),
        }}
        m_padPreviewGAL={<PadPreviewGAL dialog={d} frame={frame} />}
        m_parentInfo={d.m_parentInfo}
        m_cbShowPadOutline={check(d.m_cbShowPadOutline, () => d.onChangePadDrawMode())}
        onOK={onOK}
        onCancel={onCancel}
      />
      {d.m_messages && (
        <HtmlMessageBox
          caption={d.m_messages.title}
          messages={d.m_messages.messages}
          onClose={() => {
            d.m_messages = null;

            if (closing) onClose(true);
            else bump();
          }}
        />
      )}
      {d.m_error !== null && (
        <MessageDialogError
          message={d.m_error}
          onClose={() => {
            d.m_error = null;
            bump();
          }}
        />
      )}
      {confirm && (
        <MessageDialogOkCancel
          caption={confirm.caption}
          message={confirm.message}
          icon="warning"
          onResult={(aOk) => {
            setConfirm(null);
            confirm.resolve(aOk);
          }}
        />
      )}
    </>
  );
}
