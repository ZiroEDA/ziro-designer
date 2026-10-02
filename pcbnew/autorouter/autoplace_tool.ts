// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/autorouter/autoplace_tool.cpp`: AUTOPLACE_TOOL, the two Autoplace
 * actions (`PCB_ACTIONS::autoplaceSelectedComponents`,
 * `autoplaceOffboardComponents`) that drive {@link AR_AUTOPLACER}.
 *
 * KiCad's overlay, refresh callback and WX_PROGRESS_REPORTER show the run as it
 * goes; this run is synchronous, so the commit's push is the only redraw.
 */
import { PCB_LAYER_ID, LayerName } from '@ziroeda/common/layer_id.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import { PCB_ACTIONS } from '../tools/pcb_actions.js';
import { PCB_TOOL_BASE } from '../tools/pcb_tool_base.js';
import { AR_AUTOPLACER, AR_RESULT } from './ar_autoplacer.js';

export class AUTOPLACE_TOOL extends PCB_TOOL_BASE {
  constructor() {
    super('pcbnew.Autoplacer');
  }

  private autoplace(aFootprints: FOOTPRINT[]): number {
    const bbox = this.board().GetBoardEdgesBoundingBox();

    if (bbox.GetWidth() === 0 || bbox.GetHeight() === 0) {
      const msg = `Board edges must be defined on the ${LayerName(PCB_LAYER_ID.Edge_Cuts)} layer.`;

      // `GetInfoBar()->RemoveAllButtons(); ShowMessageFor( msg, 5000, wxICON_ERROR )`.
      this.frame<PCB_EDIT_FRAME>().ShowInfoBarError(msg);
      return 0;
    }

    let footprints = aFootprints;

    if (!this.frame().GetOverrideLocks()) footprints = footprints.filter((fp) => !fp.IsLocked());

    this.Activate();

    const autoplacer = new AR_AUTOPLACER(this.board());
    const commit = new BOARD_COMMIT(this.frame());

    const result = autoplacer.AutoplaceFootprints(footprints, commit, false);

    if (result === AR_RESULT.AR_COMPLETED) commit.Push('Autoplace Footprints');
    else commit.Revert();

    return 0;
  }

  autoplaceSelected(_aEvent: TOOL_EVENT): number {
    const footprints: FOOTPRINT[] = [];

    for (const item of this.selection()) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) footprints.push(item as FOOTPRINT);
    }

    return this.autoplace(footprints);
  }

  autoplaceOffboard(_aEvent: TOOL_EVENT): number {
    const boardShape = new SHAPE_POLY_SET();
    this.board().GetBoardPolygonOutlines(boardShape, true);

    const footprints: FOOTPRINT[] = [];

    for (const footprint of this.board().Footprints()) {
      if (!boardShape.Contains(footprint.GetPosition())) footprints.push(footprint);
    }

    return this.autoplace(footprints);
  }

  protected override setTransitions(): void {
    this.Go(
      SYNC_HANDLER<AUTOPLACE_TOOL>(this.autoplaceSelected),
      PCB_ACTIONS.autoplaceSelectedComponents.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<AUTOPLACE_TOOL>(this.autoplaceOffboard),
      PCB_ACTIONS.autoplaceOffboardComponents.MakeEvent(),
    );
  }
}
