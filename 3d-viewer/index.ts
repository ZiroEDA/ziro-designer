// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @ziroeda/3d-viewer, KiCad's `3d-viewer/`: the three.js scene builder
 * (`3d_rendering`'s counterpart), the OpenCascade STEP/IGES loader
 * (`3d_cache`'s counterpart, minus the on-disk `.3dc` cache — that stays with
 * the app, see `pcb3d.ts`'s header), and `EDA_3D_VIEWER_FRAME` itself
 * (`3d_viewer/`) with its menu bar and toolbars.
 *
 * This package never imports `designer/`: whatever it needs from the running
 * app — the tessellation cache, the hosted `packages3D` bucket, the
 * Preferences dialog, the account's file dialogs — arrives through
 * `Viewer3DFrame`'s props or `loadmodel.ts`'s `setModelCache`, the same seam
 * `CVPCB_APP` gives `cvpcb/`.
 *
 * The package barrel; import a file by its KiCad name for anything else.
 */

export * from './viewer3d_types.js';
