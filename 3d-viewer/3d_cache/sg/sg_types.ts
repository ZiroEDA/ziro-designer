// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `include/plugins/3dapi/sg_types.h`: the scene graph's node types. */
export enum SGTYPES {
  SGTYPE_TRANSFORM = 0,
  SGTYPE_APPEARANCE,
  SGTYPE_COLORS,
  SGTYPE_COLORINDEX,
  SGTYPE_FACESET,
  SGTYPE_COORDS,
  SGTYPE_COORDINDEX,
  SGTYPE_NORMALS,
  SGTYPE_SHAPE,
  SGTYPE_END,
}
