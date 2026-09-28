// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `include/zoom_defines.h`, verbatim. */

// List of predefined zooms used in zoom in/out from hotkeys, context menu and toolbar
// Zooming using mouse wheel can have different limits
export const ZOOM_LIST_GERBVIEW: readonly number[] = [
  0.022, 0.035, 0.05, 0.08, 0.13, 0.22, 0.35, 0.6, 1.0, 2.2, 3.5, 5.0, 8.0, 13.0, 22.0, 35.0, 50.0,
  80.0, 130.0, 220.0,
];

export const ZOOM_LIST_PCBNEW: readonly number[] = [
  0.13, 0.22, 0.35, 0.6, 1.0, 1.5, 2.2, 3.5, 5.0, 8.0, 13.0, 20.0, 35.0, 50.0, 80.0, 130.0, 220.0,
  300.0,
];

export const ZOOM_LIST_PCBNEW_HYPER: readonly number[] = [
  0.6, 1.0, 1.5, 2.2, 3.5, 5.0, 8.0, 13.0, 20.0, 35.0, 50.0, 80.0, 130.0, 220.0, 350.0, 600.0,
  900.0, 1500.0,
];

export const ZOOM_LIST_PL_EDITOR: readonly number[] = [
  0.022, 0.035, 0.05, 0.08, 0.13, 0.22, 0.35, 0.6, 1.0, 2.2, 3.5, 5.0, 8.0, 13.0, 22.0, 35.0, 50.0,
  80.0, 130.0, 220.0,
];

export const ZOOM_LIST_EESCHEMA: readonly number[] = [
  0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.5, 6.5, 10.0, 15.0, 20.0, 30.0,
  45.0, 65.0, 100.0,
];

// Zoom scale limits for zoom (especially mouse wheel)
// the limits can differ from zoom list because the zoom list cannot be as long as
// we want because the zoom list is displayed in menus.
// But zoom by mouse wheel is limited mainly by the usability

// Scale limits for zoom  for Eeschema
export const ZOOM_MAX_LIMIT_EESCHEMA = 100;
export const ZOOM_MIN_LIMIT_EESCHEMA = 0.01;
export const ZOOM_MAX_LIMIT_EESCHEMA_PREVIEW = 20;
export const ZOOM_MIN_LIMIT_EESCHEMA_PREVIEW = 0.5;

// Scale limits for zoom for pl_editor
export const ZOOM_MAX_LIMIT_PLEDITOR = 20;
export const ZOOM_MIN_LIMIT_PLEDITOR = 0.05;

// Scale limits for zoom for gerbview
export const ZOOM_MAX_LIMIT_GERBVIEW = 5000;
export const ZOOM_MIN_LIMIT_GERBVIEW = 0.02;

// Scale limits for zoom (especially mouse wheel) for Pcbnew
export const ZOOM_MAX_LIMIT_PCBNEW = 50000;
export const ZOOM_MIN_LIMIT_PCBNEW = 0.1;
