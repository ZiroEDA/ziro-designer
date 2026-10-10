// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_coordindex.cpp`: IFSG_COORDINDEX, a coordIndex node. */
import { IFSG_NODE, type IFSG_PARENT } from './ifsg_node.js';
import { SGCOORDINDEX } from './sg_coordindex.js';

export class IFSG_COORDINDEX extends IFSG_NODE {
  constructor(aParent: IFSG_PARENT | false = null) {
    super();

    if (aParent !== false) this.NewNode(aParent);
  }

  NewNode(aParent: IFSG_PARENT): boolean {
    this.m_node = new SGCOORDINDEX(IFSG_NODE.raw(aParent));
    return true;
  }

  private node(): SGCOORDINDEX {
    return this.m_node as SGCOORDINDEX;
  }

  SetIndices(aIndexList: readonly number[]): boolean {
    this.node().SetIndices(aIndexList);
    return true;
  }

  AddIndex(aIndex: number): boolean {
    this.node().AddIndex(aIndex);
    return true;
  }
}
