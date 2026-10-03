// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDITOR_CONDITIONS` (pcbnew/tools/pcb_editor_conditions.{h,cpp}): the
 * conditions the pcbnew frames add to EDITOR_CONDITIONS, for their UI updates.
 */
import { EDITOR_CONDITIONS } from '@ziroeda/common/tool/editor_conditions.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { SELECTION_CONDITION } from '@ziroeda/common/tool/selection_conditions.js';
import type { ZONE_DISPLAY_MODE } from '@ziroeda/common/project/board_project_settings.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_VIEWERS_SETTINGS_BASE } from '../pcbnew_settings.js';

export class PCB_EDITOR_CONDITIONS extends EDITOR_CONDITIONS {
  constructor(aFrame: PCB_BASE_FRAME) {
    super(aFrame);
  }

  /** Requires a PCB_BASE_FRAME. */
  private pcbFrame(): PCB_BASE_FRAME {
    return this.m_frame as unknown as PCB_BASE_FRAME;
  }

  /** A functor testing if there are any items in the editor. */
  HasItems(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.hasItemsFunc(aSel, drwFrame);
  }

  /** A functor testing if the pad numbers are displayed. */
  PadNumbersDisplay(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.padNumberDisplayFunc(aSel, drwFrame);
  }

  /** A functor testing if the pad fill display is enabled. */
  PadFillDisplay(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.padFillDisplayFunc(aSel, drwFrame);
  }

  /** A functor testing if the text fill display is enabled. */
  TextFillDisplay(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.textFillDisplayFunc(aSel, drwFrame);
  }

  /** A functor testing if the graphics fill display is enabled. */
  GraphicsFillDisplay(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.graphicsFillDisplayFunc(aSel, drwFrame);
  }

  /** A functor testing if the via fill display is enabled. */
  ViaFillDisplay(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.viaFillDisplayFunc(aSel, drwFrame);
  }

  /** A functor testing if the track fill display is enabled. */
  TrackFillDisplay(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.trackFillDisplayFunc(aSel, drwFrame);
  }

  /** A functor testing the current zone display mode in the frame. */
  ZoneDisplayMode(aMode: ZONE_DISPLAY_MODE): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.zoneDisplayModeFunc(aSel, drwFrame, aMode);
  }

  /** A functor testing if the footprint viewer should auto zoom on new footprints. */
  FootprintViewerAutoZoom(): SELECTION_CONDITION {
    const drwFrame = this.pcbFrame();
    return (aSel) => PCB_EDITOR_CONDITIONS.footprintViewerAutoZoom(aSel, drwFrame);
  }

  protected static hasItemsFunc(_aSelection: SELECTION, aFrame: PCB_BASE_FRAME): boolean {
    const board = aFrame.GetBoard();

    return !!board && !board.IsEmpty();
  }

  protected static padNumberDisplayFunc(_aSelection: SELECTION, aFrame: PCB_BASE_FRAME): boolean {
    return aFrame.GetViewerSettingsBase().m_ViewersDisplay.m_DisplayPadNumbers;
  }

  protected static padFillDisplayFunc(_aSelection: SELECTION, aFrame: PCB_BASE_FRAME): boolean {
    return aFrame.GetViewerSettingsBase().m_ViewersDisplay.m_DisplayPadFill;
  }

  protected static textFillDisplayFunc(_aSelection: SELECTION, aFrame: PCB_BASE_FRAME): boolean {
    return aFrame.GetViewerSettingsBase().m_ViewersDisplay.m_DisplayTextFill;
  }

  protected static graphicsFillDisplayFunc(
    _aSelection: SELECTION,
    aFrame: PCB_BASE_FRAME,
  ): boolean {
    return aFrame.GetViewerSettingsBase().m_ViewersDisplay.m_DisplayGraphicsFill;
  }

  protected static viaFillDisplayFunc(_aSelection: SELECTION, aFrame: PCB_BASE_FRAME): boolean {
    return aFrame.GetPcbNewSettings().m_Display.m_DisplayViaFill;
  }

  protected static trackFillDisplayFunc(_aSelection: SELECTION, aFrame: PCB_BASE_FRAME): boolean {
    return aFrame.GetPcbNewSettings().m_Display.m_DisplayPcbTrackFill;
  }

  protected static zoneDisplayModeFunc(
    _aSelection: SELECTION,
    aFrame: PCB_BASE_FRAME,
    aMode: ZONE_DISPLAY_MODE,
  ): boolean {
    return aFrame.GetDisplayOptions().m_ZoneDisplayMode === aMode;
  }

  protected static footprintViewerAutoZoom(
    _aSelection: SELECTION,
    aFrame: PCB_BASE_FRAME,
  ): boolean {
    return (aFrame.config() as PCB_VIEWERS_SETTINGS_BASE).m_FootprintViewerAutoZoomOnSelect;
  }
}
