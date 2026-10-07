// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PREVIEW_3D_MODEL`'s canvas under the 3D Models page of Footprint
 * Properties: `UpdateDummyFootprint()` copies the footprint, gives the copy the
 * panel's model list, and the `EDA_3D_CANVAS` draws that copy on a footprint
 * holder. Here the copy goes onto the same holder board the footprint chooser's
 * 3D preview draws on, through the same `mount3DViewer` (WebGL) in its
 * footprint-holder mode.
 *
 * The panel's own rotation / offset / opacity controls and its toolbar are not
 * here: they belong to `PANEL_PREVIEW_3D_MODEL`, which is a `3d-viewer/` file
 * and not yet ported.
 */
import { useMemo, type JSX } from 'react';
import type { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { FootprintPreview3D, HOLDER_BOARD } from './footprint_preview_3d.js';

export function FootprintModelPreview3D({
  footprint,
  models,
  version,
}: {
  footprint: FOOTPRINT;
  /** The panel's list, which is what the dummy footprint is given. */
  models: readonly FP_3DMODEL[];
  /** The panel's change counter, so an edit in place redraws. */
  version: number;
}): JSX.Element {
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the list's change counter
  const board = useMemo(() => {
    const holder = ParseBoard(HOLDER_BOARD);
    const dummy = footprint.Clone() as FOOTPRINT;
    dummy.Models().length = 0;
    dummy.Models().push(...models.filter((m) => m.m_Filename !== '').map((m) => m.clone()));
    dummy.SetPosition({ x: 0, y: 0 });
    holder.Add(dummy);
    return holder;
  }, [footprint, models, version]);

  return <FootprintPreview3D board={board} />;
}
