// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Origins & Axes — `PANEL_PCBNEW_DISPLAY_ORIGIN`
 * with `FRAME_PCB_EDITOR` (`pcbnew/pcbnew.cpp:421-423`), which is the same
 * class the footprint editor's page builds and the frame type is the whole
 * difference: this one shows the Display Origin group.
 *
 * **What reads it.** `PCB_BASE_FRAME::GetUserOrigin()` turns `m_DisplayOrigin`
 * into a point — nothing for PAGE, `GetAuxOrigin()` for AUX, `GetGridOrigin()`
 * for GRID — and `PCB_ORIGIN_TRANSFORMS::ToDisplayAbs{X,Y}` subtracts it from
 * every coordinate the status bar prints. The two axis flags negate the
 * printed value on top of that. Nothing on the board moves: this is the
 * READOUT, which is why `useStatusReadout` is where all three land.
 */
import type { JSX } from 'react';
import { PanelDisplayOrigin } from '../../../dialogs/prefs/PanelDisplayOrigin.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelPcbOriginsAxes({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { pcbnew, upP } = ctx;
  return (
    <PanelDisplayOrigin
      idPrefix="pcb"
      showDisplayOrigin
      value={pcbnew.pcb_display}
      onChange={(patch) =>
        upP((s) => {
          Object.assign(s.pcb_display, patch);
        })
      }
    />
  );
}
