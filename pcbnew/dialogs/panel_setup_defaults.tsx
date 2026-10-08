// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Text & Graphics > Defaults. Counterpart:
 * `pcbnew/dialogs/panel_setup_defaults.cpp` (`PANEL_SETUP_DEFAULTS`), which is
 * THREE panels in one scrolled window: text & graphics, a 10 px spacer,
 * dimensions, another spacer, then zones (`panel_setup_defaults.cpp:39-48`). The
 * first two are `PanelPcbTextGraphics`; the third is `PanelPcbZones`.
 */
import type { JSX } from 'react';
import { PanelPcbTextGraphics, type TextGfxDefaults } from './panel_setup_text_and_graphics.js';
import { PanelPcbZones, type ZoneDefaults } from './panel_setup_zones.js';

export function PanelSetupDefaults({
  textGraphics,
  onTextGraphics,
  zones,
  onZones,
}: {
  textGraphics: TextGfxDefaults;
  onTextGraphics: (next: TextGfxDefaults) => void;
  zones: ZoneDefaults;
  onZones: (next: ZoneDefaults) => void;
}): JSX.Element {
  return (
    <div className="ze-pcb-defaults">
      <PanelPcbTextGraphics value={textGraphics} onChange={onTextGraphics} />
      <PanelPcbZones value={zones} onChange={onZones} />
    </div>
  );
}
