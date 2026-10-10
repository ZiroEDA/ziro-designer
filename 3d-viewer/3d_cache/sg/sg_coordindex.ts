// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_coordindex.{h,cpp}`: SGCOORDINDEX, a face set's triangle list. */
import type { SGNODE } from './sg_node.js';
import { SGINDEX } from './sg_index.js';
import { SGTYPES } from './sg_types.js';

export class SGCOORDINDEX extends SGINDEX {
  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_COORDINDEX;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_FACESET) this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }
}
