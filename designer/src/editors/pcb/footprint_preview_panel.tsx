// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_PREVIEW_PANEL::New( aKiway, … )` for this program: the panel
 * (`pcbnew/footprint_preview_panel.tsx`) handed the footprint libraries and
 * `Pgm()`.
 *
 * Loaded on demand, as upstream's is: `FOOTPRINT_PREVIEW_PANEL_BASE::Create`
 * asks `aKiway.KiFACE( KIWAY::FACE_PCB )`, which loads pcbnew the first time a
 * preview is wanted (footprint_preview_widget.cpp:146-166). A symbol chooser
 * that never shows a footprint never pays for the board view.
 */
import { lazy, Suspense } from 'react';
import type { FOOTPRINT_PREVIEW_PANEL_BASE } from '@ziroeda/common/widgets/footprint_preview_widget.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { commonSettingsOf } from '../../pgm_app.js';

/** `KiFACE( FACE_PCB )->CreateKiWindow( FRAME_FOOTPRINT_PREVIEW )`, once loaded. */
const PcbPreviewCanvas = lazy(async () => {
  const [{ FOOTPRINT_PREVIEW_PANEL_New }, { installPgm }, { loadLibraryFootprint }] =
    await Promise.all([
      import('@ziroeda/pcbnew/footprint_preview_panel.js'),
      import('./pcb_canvas.js'),
      import('./footprint_lib_adapter_app.js'),
    ]);
  const panel = FOOTPRINT_PREVIEW_PANEL_New({
    resolve: loadLibraryFootprint,
    installPgm: () => void installPgm(),
    commonSettings: commonSettingsOf,
  });
  return { default: ({ footprint }: { footprint: FOOTPRINT }) => panel.render(footprint) };
});

export const PCB_FOOTPRINT_PREVIEW_PANEL: FOOTPRINT_PREVIEW_PANEL_BASE<FOOTPRINT> = {
  resolve: (libId) =>
    import('./footprint_lib_adapter_app.js').then((m) => m.loadLibraryFootprint(libId)),
  render: (footprint) => (
    <Suspense fallback={null}>
      <PcbPreviewCanvas footprint={footprint} />
    </Suspense>
  ),
};
