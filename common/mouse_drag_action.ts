// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `MOUSE_DRAG_ACTION` (include/mouse_drag_action.h). */
export enum MOUSE_DRAG_ACTION {
  // WARNING: these are encoded as integers in the file, so don't change their values.
  DRAG_ANY = -2,
  DRAG_SELECTED,
  SELECT,
  ZOOM,
  PAN,
  NONE,
}
