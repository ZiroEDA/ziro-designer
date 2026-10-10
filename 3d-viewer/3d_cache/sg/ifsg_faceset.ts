// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_faceset.cpp`: IFSG_FACESET, an IndexedFaceSet node. */
import { IFSG_NODE, type IFSG_PARENT } from './ifsg_node.js';
import { SGFACESET } from './sg_faceset.js';

export class IFSG_FACESET extends IFSG_NODE {
  constructor(aParent: IFSG_PARENT | false = null) {
    super();

    if (aParent !== false) this.NewNode(aParent);
  }

  NewNode(aParent: IFSG_PARENT): boolean {
    this.m_node = new SGFACESET(IFSG_NODE.raw(aParent));
    return true;
  }

  private node(): SGFACESET {
    return this.m_node as SGFACESET;
  }
}
