// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * 3D viewer menu bar, transcribed from KiCad's
 * `3d-viewer/3d_viewer/3d_menubar.cpp` (EDA_3D_VIEWER_FRAME::doReCreateMenuBar).
 *
 * Order, separators, submenus and check items follow that function exactly;
 * labels are each action's `.FriendlyName()` and shortcuts its
 * `.DefaultHotkey()` from `3d-viewer/3d_viewer/tools/eda_3d_actions.cpp` and
 * `common/tool/actions.cpp`.
 *
 * Built as a function rather than a constant because half the entries are
 * check items whose state is the viewer's, and every entry needs a handler.
 */

import type { Menu, MenuItem } from '../../ui/menu_types.js';
import { addClose } from '../../ui/action_menu.js';
import type { Grid3D } from './viewer3d_types.js';

export interface Viewer3DMenuState {
  grid: Grid3D;
  ortho: boolean;
  showMissingModels: boolean;
  raytracing: boolean;
  showAppearanceManager: boolean;
}

export interface Viewer3DMenuActions {
  exportImage: () => void;
  close: () => void;
  copyToClipboard: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  redraw: () => void;
  setGrid: (g: Grid3D) => void;
  setView: (d: 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back') => void;
  rotate: (axis: 'x' | 'y' | 'z', cw: boolean) => void;
  flip: () => void;
  move: (d: 'left' | 'right' | 'up' | 'down') => void;
  toggleShowMissingModels: () => void;
  openPreferences: () => void;
  resetToDefaults: () => void;
}

/** Feature not ported yet, greyed in its upstream slot (repo convention). */
const todo = { disabled: true } as const;

export function buildViewer3DMenus(state: Viewer3DMenuState, on: Viewer3DMenuActions): Menu[] {
  //-- File menu -----------------------------------------------------------
  const fileMenu: MenuItem[] = [
    { label: 'Export Image...', icon: 'exportImage3d', action: on.exportImage },
    { sep: true },
    addClose('3D Viewer', on.close),
  ];

  //-- Edit menu -----------------------------------------------------------
  const editMenu: MenuItem[] = [
    { label: 'Copy 3D Image to Clipboard', icon: 'copyToClipboard3d', action: on.copyToClipboard },
  ];

  //-- View menu -----------------------------------------------------------
  const gridSubmenu: MenuItem[] = [
    { label: 'No 3D Grid', checked: state.grid === 'none', action: () => on.setGrid('none') },
    { label: '3D Grid 10mm', checked: state.grid === '10mm', action: () => on.setGrid('10mm') },
    { label: '3D Grid 5mm', checked: state.grid === '5mm', action: () => on.setGrid('5mm') },
    { label: '3D Grid 2.5mm', checked: state.grid === '2.5mm', action: () => on.setGrid('2.5mm') },
    { label: '3D Grid 1mm', checked: state.grid === '1mm', action: () => on.setGrid('1mm') },
  ];

  const rotateSubmenu: MenuItem[] = [
    { label: 'Rotate X Clockwise', icon: 'rotateXCW', action: () => on.rotate('x', true) },
    { label: 'Rotate X Counterclockwise', icon: 'rotateXCCW', action: () => on.rotate('x', false) },
    { sep: true },
    { label: 'Rotate Y Clockwise', icon: 'rotateYCW', action: () => on.rotate('y', true) },
    { label: 'Rotate Y Counterclockwise', icon: 'rotateYCCW', action: () => on.rotate('y', false) },
    { sep: true },
    {
      label: 'Rotate Z Clockwise',
      icon: 'rotateZCW',
      shortcut: 'Shift+R',
      action: () => on.rotate('z', true),
    }, // prettier-ignore
    {
      label: 'Rotate Z Counterclockwise',
      icon: 'rotateZCCW',
      shortcut: 'R',
      action: () => on.rotate('z', false),
    }, // prettier-ignore
  ];

  const moveSubmenu: MenuItem[] = [
    {
      label: 'Move Board Left',
      icon: 'moveLeft3d',
      shortcut: 'Left',
      action: () => on.move('left'),
    },
    {
      label: 'Move Board Right',
      icon: 'moveRight3d',
      shortcut: 'Right',
      action: () => on.move('right'),
    }, // prettier-ignore
    { label: 'Move Board Up', icon: 'moveUp3d', shortcut: 'Up', action: () => on.move('up') },
    {
      label: 'Move Board Down',
      icon: 'moveDown3d',
      shortcut: 'Down',
      action: () => on.move('down'),
    },
  ];

  const viewMenu: MenuItem[] = [
    { label: 'Zoom In', icon: 'zoomIn', action: on.zoomIn },
    { label: 'Zoom Out', icon: 'zoomOut', action: on.zoomOut },
    { label: 'Zoom to Fit', icon: 'zoomFit', shortcut: 'Home', action: on.zoomFit },
    { label: 'Refresh', icon: 'zoomRedraw', shortcut: 'F5', action: on.redraw },
    { sep: true },
    { label: '3D Grid', icon: 'grid', submenu: gridSubmenu },
    { sep: true },
    { label: 'View Top', icon: 'viewTop', shortcut: 'Z', action: () => on.setView('top') },
    {
      label: 'View Bottom',
      icon: 'viewBottom',
      shortcut: 'Shift+Z',
      action: () => on.setView('bottom'),
    }, // prettier-ignore
    { label: 'View Right', icon: 'viewRight', shortcut: 'X', action: () => on.setView('right') },
    { label: 'View Left', icon: 'viewLeft', shortcut: 'Shift+X', action: () => on.setView('left') },
    { label: 'View Front', icon: 'viewFront', shortcut: 'Y', action: () => on.setView('front') },
    { label: 'View Back', icon: 'viewBack', shortcut: 'Shift+Y', action: () => on.setView('back') },
    { sep: true },
    { label: 'Rotate Board', icon: 'rotateCW', submenu: rotateSubmenu },
    { label: 'Flip Board', icon: 'flipView3d', shortcut: 'F', action: on.flip },
    { label: 'Move Board', icon: 'move', submenu: moveSubmenu },
    { sep: true },
    // The appearance pane itself is not ported yet.
    {
      label: 'Show Appearance Manager',
      icon: 'showLayersManager',
      checked: state.showAppearanceManager,
      ...todo,
    }, // prettier-ignore
  ];

  //-- Preferences menu ----------------------------------------------------
  const prefsMenu: MenuItem[] = [
    // Raytracing is the second renderer (render_3d_raytrace_*.cpp), deferred.
    { label: 'Use raytracing', icon: 'toggleRaytracing', checked: state.raytracing, ...todo },
    {
      label: 'Show parts without 3D model',
      checked: state.showMissingModels,
      action: on.toggleShowMissingModels,
    },
    { label: 'Preferences...', shortcut: 'Ctrl+,', action: on.openPreferences },
    { label: 'Reset to Default Settings', action: on.resetToDefaults },
    // AddMenuLanguageList: the language list is app-wide for us, not per frame.
  ];

  return [
    { label: 'File', items: fileMenu },
    { label: 'Edit', items: editMenu },
    { label: 'View', items: viewMenu },
    { label: 'Preferences', items: prefsMenu },
  ];
}
