// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `aKiway.KiFACE( KIWAY::FACE_PCB ).CreateKiWindow( FRAME_FOOTPRINT_PREVIEW )`:
 * the program's `FOOTPRINT_PREVIEW_PANEL` (`pcbnew/footprint_preview_panel.tsx`),
 * handed designer's footprint library lookup and `pcbnew.json`'s cursor
 * preferences. The panel itself moved to `pcbnew/`; this is its wiring.
 */
import type { FOOTPRINT_PREVIEW_PANEL_BASE } from '@ziroeda/common/widgets/footprint_preview_widget.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/types.js';
import { FOOTPRINT_PREVIEW_PANEL_New } from '@ziroeda/pcbnew/footprint_preview_panel.js';
import { settings } from '../../prefs/settings.js';
import { loadFootprint } from '../../widgets/footprint_list.js';

export const PCB_FOOTPRINT_PREVIEW_PANEL: FOOTPRINT_PREVIEW_PANEL_BASE<PcbFootprint> =
  FOOTPRINT_PREVIEW_PANEL_New({
    resolve: loadFootprint,
    cursorPrefs: () => settings.pcbnew.window.cursor,
  });
