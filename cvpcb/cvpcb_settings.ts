// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CVPCB_SETTINGS` (`common/settings/cvpcb_settings.cpp`): `cvpcb.json`.
 * Upstream keeps it in common/ beside the PCB_VIEWERS_SETTINGS_BASE it
 * derives from; ours of that base is pcbnew's (`pcbnew_settings.ts`), which
 * common/ cannot import, so this lives with its one reader.
 */
import { WINDOW_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import {
  MAGNETIC_OPTIONS,
  MAGNETIC_SETTINGS,
  PCB_VIEWERS_SETTINGS_BASE,
} from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_DISPLAY_OPTIONS } from '@ziroeda/pcbnew/pcb_painter.js';

const cvpcbSchemaVersion = 0;

export class CVPCB_SETTINGS extends PCB_VIEWERS_SETTINGS_BASE {
  /** `filter_footprint`. */
  m_FilterFlags = 0;
  /** `filter_footprint_text`. */
  m_FilterString = '';
  /** `libraries_pane_width`. */
  m_LibrariesWidth = 0;
  /** `footprints_pane_width`. */
  m_FootprintsWidth = 0;
  /** `footprint_viewer.*`: DISPLAY_FOOTPRINTS_FRAME's window settings. */
  m_FootprintViewer = new WINDOW_SETTINGS();
  /** `m_FootprintViewerDisplayOptions`: what SaveSettings keeps of the frame's display options. */
  m_FootprintViewerDisplayOptions = new PCB_DISPLAY_OPTIONS();
  /** `m_FootprintViewerMagneticSettings`: "we always snap and don't let the user configure it". */
  m_FootprintViewerMagneticSettings = new MAGNETIC_SETTINGS();

  constructor() {
    super('cvpcb', cvpcbSchemaVersion);

    this.addParamsForWindow(this.m_FootprintViewer);

    this.m_FootprintViewerMagneticSettings.pads = MAGNETIC_OPTIONS.CAPTURE_ALWAYS;
    this.m_FootprintViewerMagneticSettings.tracks = MAGNETIC_OPTIONS.CAPTURE_ALWAYS;
    this.m_FootprintViewerMagneticSettings.graphics = true;

    // `footprint_viewer.zoom` 1.0 and `.autozoom` true are the base's defaults.
    this.m_ViewersDisplay.m_AngleSnapMode = LEADER_MODE.DEG45;
    this.m_ViewersDisplay.m_DisplayPadFill = true;
    this.m_ViewersDisplay.m_DisplayPadNumbers = true;
    this.m_ViewersDisplay.m_DisplayTextFill = true;
    this.m_ViewersDisplay.m_DisplayGraphicsFill = true;
  }
}
