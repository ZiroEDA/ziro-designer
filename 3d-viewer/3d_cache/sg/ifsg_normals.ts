// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/ifsg_normals.cpp`: IFSG_NORMALS, a Normal node. */
import { IFSG_NODE, type IFSG_PARENT } from './ifsg_node.js';
import type { SGVECTOR } from './sg_base.js';
import { SGNORMALS } from './sg_normals.js';

export class IFSG_NORMALS extends IFSG_NODE {
  constructor(aParent: IFSG_PARENT | false = null) {
    super();

    if (aParent !== false) this.NewNode(aParent);
  }

  NewNode(aParent: IFSG_PARENT): boolean {
    this.m_node = new SGNORMALS(IFSG_NODE.raw(aParent));
    return true;
  }

  private node(): SGNORMALS {
    return this.m_node as SGNORMALS;
  }

  AddNormal(aX: number | SGVECTOR, aY?: number, aZ?: number): boolean {
    this.node().AddNormal(aX, aY, aZ);
    return true;
  }
}
