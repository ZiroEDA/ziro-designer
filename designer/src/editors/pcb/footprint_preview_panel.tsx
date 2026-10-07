// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_PREVIEW_PANEL::New( aKiway, … )` for this program: the panel
 * (`pcbnew/footprint_preview_panel.tsx`) handed the footprint libraries and
 * `Pgm()`.
 */
import type { FOOTPRINT_PREVIEW_PANEL_BASE } from '@ziroeda/common/widgets/footprint_preview_widget.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { FOOTPRINT_PREVIEW_PANEL_New } from '@ziroeda/pcbnew/footprint_preview_panel.js';
import { commonSettingsOf } from '../../pgm_app.js';
import { loadLibraryFootprint } from './footprint_lib_adapter_app.js';
import { installPgm } from './pcb_canvas.js';

export const PCB_FOOTPRINT_PREVIEW_PANEL: FOOTPRINT_PREVIEW_PANEL_BASE<FOOTPRINT> =
  FOOTPRINT_PREVIEW_PANEL_New({
    resolve: loadLibraryFootprint,
    installPgm: () => void installPgm(),
    commonSettings: commonSettingsOf,
  });
