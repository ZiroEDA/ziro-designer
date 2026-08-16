// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * 3D viewer toolbar layout, transcribed from KiCad's
 * `3d-viewer/3d_viewer/toolbars_3d.cpp`
 * (EDA_3D_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig).
 *
 * TOP_MAIN is the only toolbar the 3D viewer has — upstream returns
 * `std::nullopt` for LEFT, RIGHT and TOP_AUX, so there is deliberately no
 * side toolbar here. Separators mirror each `AppendSeparator()`.
 *
 * Ids match `EDA_3D_ACTIONS::<name>` so this reads against the source, except
 * where a name already means something else in the PCB editor's own toolbar
 * inventory (`moveLeft` etc.), which take a `3d` suffix.
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

const sep: ToolEntry = 'sep';

/**
 * Not yet ported, shown greyed in its upstream position (repo convention).
 * Raytracing is the whole second renderer (render_3d_raytrace_*.cpp) and is
 * deferred; the button stays so the toolbar keeps KiCad's shape.
 */
const todo = { disabled: true } as const;

/** TOP_MAIN toolbar (the only one). */
export const VIEWER3D_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'reloadBoard3d', icon: 'reloadBoard3d', title: 'Reload board' },
  sep,
  { id: 'copyToClipboard3d', icon: 'copyToClipboard3d', title: 'Copy 3D image to clipboard' },
  sep,
  {
    id: 'toggleRaytracing',
    icon: 'toggleRaytracing',
    title: 'Render current view using Raytracing',
    toggle: true,
    ...todo,
  }, // prettier-ignore
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit 3D model' },
  sep,
  { id: 'rotateXCW', icon: 'rotateXCW', title: 'Rotate X clockwise' },
  { id: 'rotateXCCW', icon: 'rotateXCCW', title: 'Rotate X counterclockwise' },
  sep,
  { id: 'rotateYCW', icon: 'rotateYCW', title: 'Rotate Y clockwise' },
  { id: 'rotateYCCW', icon: 'rotateYCCW', title: 'Rotate Y counterclockwise' },
  sep,
  { id: 'rotateZCW', icon: 'rotateZCW', title: 'Rotate Z clockwise' },
  { id: 'rotateZCCW', icon: 'rotateZCCW', title: 'Rotate Z counterclockwise' },
  sep,
  { id: 'flipView3d', icon: 'flipView3d', title: 'Flip board view' },
  sep,
  { id: 'moveLeft3d', icon: 'moveLeft3d', title: 'Move left' },
  { id: 'moveRight3d', icon: 'moveRight3d', title: 'Move right' },
  { id: 'moveUp3d', icon: 'moveUp3d', title: 'Move up' },
  { id: 'moveDown3d', icon: 'moveDown3d', title: 'Move down' },
  sep,
  { id: 'toggleOrtho', icon: 'toggleOrtho', title: 'Use orthographic projection', toggle: true },
  sep,
  // The appearance/layers pane is not ported yet; the button holds its slot.
  {
    id: 'showLayersManager',
    icon: 'showLayersManager',
    title: 'Show appearance manager',
    toggle: true,
    ...todo,
  }, // prettier-ignore
];
