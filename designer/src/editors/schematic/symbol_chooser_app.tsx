// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PANEL_SYMBOL_CHOOSER_APP`'s one answer: what the symbol chooser panel
 * (`eeschema/widgets/panel_symbol_chooser.tsx`) reaches in the app. Both of
 * its hosts — the Place Symbol dialog and `SYMBOL_CHOOSER_FRAME` — pass this.
 */
import type { PANEL_SYMBOL_CHOOSER_APP } from '@ziroeda/eeschema/widgets/panel_symbol_chooser.js';
import { settings } from '../../prefs/settings.js';
import { FootprintPreviewWidget } from '@ziroeda/common/widgets/footprint_preview_widget.js';
import { filterFootprints } from '@ziroeda/pcbnew/pcbnew.js';
import { loadFootprintIndex } from '../../widgets/footprint_list.js';
import { PCB_FOOTPRINT_PREVIEW_PANEL } from '../pcb/footprint_preview_panel.js';
import {
  libraryLoaded,
  loadedLibraryItems,
  loadIndex,
  loadSymbol,
  powerSymbolTest,
  preloadLibraryItems,
} from './symbols/index.js';
import { SymbolPreviewWidget } from './widgets/symbol_preview_widget.js';

export const SYMBOL_CHOOSER_APP: PANEL_SYMBOL_CHOOSER_APP = {
  settings,
  loadIndex,
  preloadLibraryItems,
  loadSymbol,
  libraryLoaded,
  loadedLibraryItems,
  powerSymbolTest,
  filterFootprints: (request) =>
    loadFootprintIndex().then((index) => filterFootprints(index, request)),
  FootprintPreviewWidget: (props) => (
    <FootprintPreviewWidget panel={PCB_FOOTPRINT_PREVIEW_PANEL} {...props} />
  ),
  SymbolPreviewWidget: (props) => <SymbolPreviewWidget {...props} />,
};
